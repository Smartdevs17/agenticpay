import { Router } from 'express';
import { getOutboxMetrics } from '../outbox/metrics.js';
import { OutboxPublisher } from '../outbox/publisher.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const outboxRouter = Router();

outboxRouter.get('/metrics', (_req, res) => {
  res.json(getOutboxMetrics());
});

outboxRouter.post(
  '/cleanup',
  asyncHandler(async (_req, res) => {
    const publisher = new OutboxPublisher();
    const deleted = await publisher.cleanupPublishedEvents();
    res.json({ deleted });
  })
);
