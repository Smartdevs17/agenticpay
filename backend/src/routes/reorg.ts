/**
 * reorg.ts — Issue #514
 *
 * REST endpoints for chain reorganization monitoring dashboard.
 *
 * GET  /api/v1/chain/reorgs              — paginated list of reorg events
 * GET  /api/v1/chain/reorgs/dashboard    — summary stats
 * GET  /api/v1/chain/reorgs/history      — historical incidents with resolution
 * GET  /api/v1/chain/reorgs/:id          — single event + affected transactions
 * POST /api/v1/chain/reorgs/simulate     — trigger a simulated reorg (test only)
 *
 * Fix #10: all routes require a valid internal HMAC signature via
 *          verifyInternalSignature so they are not open to unauthenticated callers.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { getReorgDetector } from '../services/chain/reorg-detector.js';
import { getConfirmationTracker } from '../services/chain/confirmation-tracker.js';
import { verifyInternalSignature } from '../middleware/internalSignature.js';

const prisma = new PrismaClient();

export const reorgRouter = Router();

// Fix #10: apply auth to every route on this router
reorgRouter.use(verifyInternalSignature);

// ── Helper ────────────────────────────────────────────────────────────────────

function parseIntQuery(val: unknown, fallback: number): number {
  const n = parseInt(String(val), 10);
  return isNaN(n) ? fallback : n;
}

// Fix #6: validate a ?since= query param; returns null on invalid input
function parseSinceDate(val: unknown, defaultMs: number): Date | null {
  if (typeof val !== 'string') return new Date(Date.now() - defaultMs);
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d;
}

// ── GET /api/v1/chain/reorgs ──────────────────────────────────────────────────

reorgRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseIntQuery(req.query.page, 1);
    const limit = Math.min(parseIntQuery(req.query.limit, 20), 100);
    const network = typeof req.query.network === 'string' ? req.query.network : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;

    const where: Record<string, unknown> = {};
    if (network) where['network'] = network;
    if (status) where['status'] = status;

    const [total, events] = await Promise.all([
      prisma.reorgEvent.count({ where }),
      prisma.reorgEvent.findMany({
        where,
        orderBy: { detectedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { affectedTransactions: true } } },
      }),
    ]);

    res.json({
      data: events,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/chain/reorgs/dashboard ───────────────────────────────────────

reorgRouter.get('/dashboard', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [
      totalEvents,
      byStatus,
      deepReorgs,
      affectedTxCount,
      recentEvents,
      pendingReview,
    ] = await Promise.all([
      prisma.reorgEvent.count(),
      prisma.reorgEvent.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.reorgEvent.count({
        where: { reorgDepth: { gt: 12 } },
      }),
      prisma.transactionReorg.count(),
      prisma.reorgEvent.findMany({
        orderBy: { detectedAt: 'desc' },
        take: 5,
        include: { _count: { select: { affectedTransactions: true } } },
      }),
      prisma.transactionReorg.count({ where: { status: 'pending_review' } }),
    ]);

    const tracker = getConfirmationTracker();

    const statusCounts = Object.fromEntries(
      byStatus.map((row: { status: string; _count: { id: number } }) => [row.status, row._count.id]),
    );

    res.json({
      summary: {
        totalReorgEvents: totalEvents,
        deepReorgs,
        affectedTransactions: affectedTxCount,
        pendingReview,
        statusCounts,
      },
      networkThresholds: {
        ethereum: tracker.getThreshold('ethereum'),
        polygon: tracker.getThreshold('polygon'),
        stellar: tracker.getThreshold('stellar'),
      },
      recentEvents,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/chain/reorgs/history ─────────────────────────────────────────

reorgRouter.get('/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseIntQuery(req.query.page, 1);
    const limit = Math.min(parseIntQuery(req.query.limit, 50), 200);
    const network = typeof req.query.network === 'string' ? req.query.network : undefined;

    // Fix #6: validate ?since= before passing to Prisma
    const since = parseSinceDate(req.query.since, 30 * 24 * 3600 * 1000);
    if (since === null) {
      res.status(400).json({ error: '?since must be a valid ISO 8601 date string' });
      return;
    }

    const where: Record<string, unknown> = { detectedAt: { gte: since } };
    if (network) where['network'] = network;

    const [total, events] = await Promise.all([
      prisma.reorgEvent.count({ where }),
      prisma.reorgEvent.findMany({
        where,
        orderBy: { detectedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          affectedTransactions: {
            select: { txHash: true, status: true, resolvedAt: true },
          },
        },
      }),
    ]);

    res.json({
      data: events,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/chain/reorgs/:id ──────────────────────────────────────────────

reorgRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = await prisma.reorgEvent.findUnique({
      where: { id: req.params['id'] as string },
      include: {
        affectedTransactions: {
          orderBy: { createdAt: 'asc' },
          include: {
            payment: { select: { id: true, txHash: true, status: true, amount: true, currency: true } },
          },
        },
      },
    });

    if (!event) {
      res.status(404).json({ error: 'Reorg event not found' });
      return;
    }

    res.json({ data: event });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/chain/reorgs/simulate ───────────────────────────────────────

reorgRouter.post('/simulate', async (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'Simulation not available in production' });
    return;
  }

  try {
    const {
      network = 'ethereum',
      orphanedBlockHash,
      canonicalBlockHash,
      fromBlock,
      toBlock,
      affectedTxHashes = [],
    } = req.body as {
      network?: string;
      orphanedBlockHash: string;
      canonicalBlockHash: string;
      fromBlock: number;
      toBlock: number;
      affectedTxHashes?: string[];
    };

    if (!orphanedBlockHash || !canonicalBlockHash || fromBlock == null || toBlock == null) {
      res.status(400).json({
        error: 'orphanedBlockHash, canonicalBlockHash, fromBlock, and toBlock are required',
      });
      return;
    }

    // Fix #4: reject inverted block range before it produces a negative reorgDepth
    if (fromBlock > toBlock) {
      res.status(400).json({ error: 'fromBlock must be less than or equal to toBlock' });
      return;
    }

    const detector = getReorgDetector();
    const reorgEventId = await detector.simulateReorg(
      network,
      orphanedBlockHash,
      canonicalBlockHash,
      fromBlock,
      toBlock,
      affectedTxHashes,
    );

    const event = await prisma.reorgEvent.findUnique({
      where: { id: reorgEventId },
      include: { _count: { select: { affectedTransactions: true } } },
    });

    res.status(201).json({ data: event });
  } catch (err) {
    next(err);
  }
});
