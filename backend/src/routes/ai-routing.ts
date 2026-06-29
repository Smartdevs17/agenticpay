/**
 * AI routing admin & A/B test endpoints (#446)
 *
 * POST /api/v1/routing/decide          - get a routing decision (clients/AI agents)
 * POST /api/v1/routing/override        - manual override for a specific tenant (admin)
 * GET  /api/v1/routing/decisions       - paginated decision log
 * GET  /api/v1/routing/ab-report       - A/B test comparison: static vs AI routing
 * GET  /api/v1/routing/chain-metrics   - latest sampled chain performance
 */
import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { aiRouter } from '../services/routing/ai-router.js';

const router = Router();

// POST /api/v1/routing/decide
router.post('/decide', async (req: Request, res: Response) => {
  try {
    const { tenantId, amount, fromAsset, preferSpeed, preferCost, abVariant } = req.body as {
      tenantId?: string;
      amount?: number;
      fromAsset?: string;
      preferSpeed?: boolean;
      preferCost?: boolean;
      abVariant?: 'static' | 'ai';
    };

    const result = await aiRouter.route({
      tenantId,
      amount: amount ?? 0,
      fromAsset: fromAsset ?? 'XLM',
      preferSpeed,
      preferCost,
      abVariant: abVariant ?? 'ai',
    });

    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Routing failed' });
  }
});

// POST /api/v1/routing/override  (admin)
router.post('/override', async (req: Request, res: Response) => {
  try {
    const { tenantId, chain, actor, amount, fromAsset } = req.body as {
      tenantId?: string;
      chain: string;
      actor: string;
      amount?: number;
      fromAsset?: string;
    };

    if (!chain || !actor) {
      return res.status(400).json({ error: 'chain and actor are required' });
    }

    const result = await aiRouter.route({
      tenantId,
      amount: amount ?? 0,
      fromAsset: fromAsset ?? 'XLM',
      manualOverride: { chain, actor },
    });

    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Override failed' });
  }
});

// GET /api/v1/routing/decisions
router.get('/decisions', async (req: Request, res: Response) => {
  try {
    const { tenantId, chain, limit = '50', offset = '0' } = req.query as Record<string, string>;
    const take = Math.min(Number(limit) || 50, 200);
    const skip = Number(offset) || 0;

    const where = {
      ...(tenantId ? { tenantId } : {}),
      ...(chain ? { selectedChain: chain } : {}),
    };

    const [decisions, total] = await Promise.all([
      prisma.routingDecision.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.routingDecision.count({ where }),
    ]);

    res.json({ data: decisions, total, limit: take, offset: skip });
  } catch {
    res.status(500).json({ error: 'Failed to fetch decisions' });
  }
});

// GET /api/v1/routing/ab-report
router.get('/ab-report', async (_req: Request, res: Response) => {
  try {
    const [aiStats, staticStats] = await Promise.all([
      prisma.routingDecision.groupBy({
        by: ['selectedChain'],
        where: { abVariant: 'ai' },
        _count: { id: true },
        _avg: { latencyMs: true },
      }),
      prisma.routingDecision.groupBy({
        by: ['selectedChain'],
        where: { abVariant: 'static' },
        _count: { id: true },
        _avg: { latencyMs: true },
      }),
    ]);

    res.json({
      data: {
        ai: aiStats,
        static: staticStats,
      },
    });
  } catch {
    res.status(500).json({ error: 'Failed to generate A/B report' });
  }
});

// GET /api/v1/routing/chain-metrics
router.get('/chain-metrics', async (req: Request, res: Response) => {
  try {
    const { chain } = req.query as { chain?: string };
    const since = new Date(Date.now() - 3_600_000); // last 1 hour

    const metrics = await prisma.chainPerformanceMetric.findMany({
      where: {
        ...(chain ? { chain } : {}),
        sampleAt: { gte: since },
      },
      orderBy: { sampleAt: 'desc' },
      take: 100,
    });

    res.json({ data: metrics });
  } catch {
    res.status(500).json({ error: 'Failed to fetch chain metrics' });
  }
});

export default router;
