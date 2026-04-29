// Analytics API routes — Issue #192
// GET /api/v1/analytics — full snapshot
// GET /api/v1/analytics/funnel
// GET /api/v1/analytics/revenue
// GET /api/v1/analytics/anomalies
// POST /api/v1/analytics/track — ingest a payment event

import { Router, Request, Response } from 'express';
import { analyticsService } from '../services/analytics.js';
import type { AgenticPayWebSocketServer } from '../websocket/server.js';

export function createAnalyticsRouter(wsServer: AgenticPayWebSocketServer) {
  const router = Router();

  function parseSince(req: Request): Date | undefined {
    const { since, hours } = req.query;
    if (typeof since === 'string') {
      const d = new Date(since);
      return isNaN(d.getTime()) ? undefined : d;
    }
    if (typeof hours === 'string') {
      const h = parseInt(hours, 10);
      if (!isNaN(h) && h > 0) {
        return new Date(Date.now() - h * 3600 * 1000);
      }
    }
    return new Date(Date.now() - 24 * 3600 * 1000);
  }

  // Full snapshot
  router.get('/', (_req: Request, res: Response) => {
    const since = parseSince(_req);
    res.json(analyticsService.snapshot(since));
  });

  // Payment funnel
  router.get('/funnel', (req: Request, res: Response) => {
    res.json({ funnel: analyticsService.buildFunnel(parseSince(req)) });
  });

  // Time-series revenue
  router.get('/revenue', (req: Request, res: Response) => {
    const granularity = req.query.granularity === 'day' ? 'day' : 'hour';
    res.json({ revenue: analyticsService.buildTimeSeries(granularity, parseSince(req)) });
  });

  // Anomaly alerts
  router.get('/anomalies', (req: Request, res: Response) => {
    res.json({ anomalies: analyticsService.detectAnomalies(parseSince(req)) });
  });

  // Segmentation by network or currency
  router.get('/segmentation', (req: Request, res: Response) => {
    const field = req.query.by === 'currency' ? 'currency' : 'network';
    res.json({ data: analyticsService.buildSegmentation(field, parseSince(req)) });
  });

  // Ingest a payment event and broadcast via WebSocket
  router.post('/track', (req: Request, res: Response) => {
    const { id, amount, currency, network, status } = req.body as Record<string, unknown>;

    if (
      typeof id !== 'string' ||
      typeof amount !== 'number' ||
      typeof currency !== 'string' ||
      typeof network !== 'string' ||
      !['initiated', 'confirmed', 'completed', 'failed'].includes(status as string)
    ) {
      res.status(400).json({ error: 'Invalid payment event payload' });
      return;
    }

    analyticsService.trackPayment({ id, amount, currency, network, status: status as 'initiated' | 'confirmed' | 'completed' | 'failed' });

    // Broadcast updated snapshot to all WebSocket subscribers
    wsServer.broadcast({
      type: 'analytics:update',
      payload: analyticsService.snapshot(),
    });

    res.json({ ok: true });
  });

  return router;
}
