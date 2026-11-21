/**
 * REST API routes for the smart contract event indexer (#447).
 * GET  /api/v1/indexer/events          - paginated event history with filtering
 * GET  /api/v1/indexer/events/:id      - single event by id
 * DELETE /api/v1/indexer/events/prune  - manual retention prune (admin)
 */
import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import type { Prisma } from '@prisma/client';

const router = Router();

// GET /api/v1/indexer/events
router.get('/events', async (req: Request, res: Response) => {
  try {
    const {
      chain,
      contractAddress,
      eventType,
      fromTimestamp,
      toTimestamp,
      limit = '50',
      offset = '0',
    } = req.query as Record<string, string | undefined>;

    const where: Prisma.IndexedEventWhereInput = {};
    if (chain) where.chain = chain as 'stellar' | 'evm';
    if (contractAddress) where.contractAddress = { equals: contractAddress, mode: 'insensitive' };
    if (eventType) where.eventType = eventType;
    if (fromTimestamp || toTimestamp) {
      where.timestamp = {
        ...(fromTimestamp ? { gte: new Date(fromTimestamp) } : {}),
        ...(toTimestamp ? { lte: new Date(toTimestamp) } : {}),
      };
    }

    const take = Math.min(Number(limit) || 50, 200);
    const skip = Number(offset) || 0;

    const [events, total] = await Promise.all([
      prisma.indexedEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take,
        skip,
        select: {
          id: true,
          dedupKey: true,
          chain: true,
          contractAddress: true,
          eventType: true,
          blockNumber: true,
          txHash: true,
          timestamp: true,
          payload: true,
          confirmations: true,
          createdAt: true,
        },
      }),
      prisma.indexedEvent.count({ where }),
    ]);

    res.json({ data: events, total, limit: take, offset: skip });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /api/v1/indexer/events/:id
router.get('/events/:id', async (req: Request, res: Response) => {
  try {
    const event = await prisma.indexedEvent.findUnique({
      where: { id: req.params.id },
    });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ data: event });
  } catch {
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// DELETE /api/v1/indexer/events/prune  (admin: prune expired events)
router.delete('/events/prune', async (_req: Request, res: Response) => {
  try {
    const result = await prisma.indexedEvent.deleteMany({
      where: { retentionUntil: { lt: new Date() } },
    });
    res.json({ pruned: result.count });
  } catch {
    res.status(500).json({ error: 'Prune failed' });
  }
});

export default router;
