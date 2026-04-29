import { Router } from 'express';
import { calculateOptimalRoute, executeWithFallback } from './route-engine';
import { getAllNetworkMetrics, getAllNetworkStatuses } from './network-monitor';
import { notifyRoutingDecision, notifyFallback } from './notification-service';
import { recordRoutingEvent, generateRoutingReport } from './analytics';
import { RoutingDecision, UserPreferences, NetworkId } from './types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// POST /api/v1/payments/route
router.post('/route', async (req, res) => {
  try {
    const {
      amountUsd,
      tokenAddress,
      fromAddress,
      toAddress,
      preferences,
    } = req.body as {
      amountUsd: number;
      tokenAddress?: string;
      fromAddress: string;
      toAddress: string;
      preferences?: UserPreferences;
    };

    if (!amountUsd || !fromAddress || !toAddress) {
      return res.status(400).json({ error: 'Missing required fields: amountUsd, fromAddress, toAddress' });
    }

    const userPrefs: UserPreferences = preferences || { priority: 'cost' };

    // Fetch real-time metrics
    const metrics = await getAllNetworkMetrics();

    // Calculate optimal route
    const route = await calculateOptimalRoute(
      { amountUsd, tokenAddress, fromAddress, toAddress },
      userPrefs,
      metrics
    );

    // Record decision
    const decision: RoutingDecision = {
      id: uuidv4(),
      timestamp: Date.now(),
      paymentId: uuidv4(),
      selectedRoute: route,
      reason: `Auto-selected based on ${userPrefs.priority} priority`,
      userNotified: false,
    };

    recordRoutingEvent({
      id: uuidv4(),
      timestamp: Date.now(),
      paymentId: decision.paymentId,
      eventType: 'route_calculated',
      networkId: route.primary,
      details: {
        scores: route.scores,
        bridgeRequired: route.bridgeRequired,
        fallbacks: route.fallbacks,
      },
    });

    // Notify user
    const userId = req.user?.id || 'anonymous';
    notifyRoutingDecision(userId, decision);

    res.json({
      decisionId: decision.id,
      paymentId: decision.paymentId,
      route,
      metrics: metrics.reduce((acc, m) => ({ ...acc, [m.networkId]: m }), {}),
    });
  } catch (error) {
    console.error('[routing:api] Route calculation failed:', error);
    res.status(500).json({
      error: 'Route calculation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/v1/payments/route/networks
router.get('/networks', async (_req, res) => {
  try {
    const [metrics, statuses] = await Promise.all([
      getAllNetworkMetrics(),
      getAllNetworkStatuses(),
    ]);

    res.json({
      networks: metrics.map((m) => ({
        ...m,
        status: statuses.find((s) => s.networkId === m.networkId)?.status,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch network status' });
  }
});

// POST /api/v1/payments/route/execute
router.post('/execute', async (req, res) => {
  try {
    const { paymentId, route, executeFn } = req.body;

    const userId = req.user?.id || 'anonymous';

    const result = await executeWithFallback(
      route,
      async (networkId: NetworkId) => {
        // In production: this would be the actual transaction submission
        // For now, simulate with a delay
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return `0x${Math.random().toString(16).slice(2, 66)}`;
      },
      (from, to, error) => {
        notifyFallback(userId, paymentId, from, to, error.message);
        recordRoutingEvent({
          id: uuidv4(),
          timestamp: Date.now(),
          paymentId,
          eventType: 'fallback_used',
          networkId: to,
          details: { fromNetwork: from, error: error.message },
        });
      }
    );

    recordRoutingEvent({
      id: uuidv4(),
      timestamp: Date.now(),
      paymentId,
      eventType: 'tx_confirmed',
      networkId: result.networkUsed,
      details: { txHash: result.txHash, attempts: result.attempts },
    });

    res.json({
      success: true,
      txHash: result.txHash,
      networkUsed: result.networkUsed,
      attempts: result.attempts,
    });
  } catch (error) {
    recordRoutingEvent({
      id: uuidv4(),
      timestamp: Date.now(),
      paymentId: req.body.paymentId,
      eventType: 'failed',
      networkId: req.body.route?.primary,
      details: { error: error instanceof Error ? error.message : 'Unknown' },
    });

    res.status(500).json({
      error: 'Execution failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/v1/payments/route/analytics
router.get('/analytics', async (req, res) => {
  try {
    const { start, end } = req.query as { start?: string; end?: string };
    const startTime = start ? parseInt(start, 10) : Date.now() - 86400000;
    const endTime = end ? parseInt(end, 10) : Date.now();

    const report = generateRoutingReport(startTime, endTime);

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

export default router;