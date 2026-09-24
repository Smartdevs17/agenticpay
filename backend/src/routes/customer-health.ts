// Customer Health Score routes — Issue #855
// Mount at /api/v1/customer-health

import { Router, Request, Response } from 'express';
import { customerHealthService } from '../services/customer-health.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

export const customerHealthRouter = Router();

// Track activity
customerHealthRouter.post(
  '/events',
  asyncHandler(async (req: Request, res: Response) => {
    const { customerId, type, amount, timestamp, metadata } = req.body as Record<string, unknown>;
    if (typeof customerId !== 'string' || typeof type !== 'string') {
      throw new AppError(400, 'customerId and type are required', 'VALIDATION_ERROR');
    }
    try {
      const event = customerHealthService.trackActivity({
        customerId,
        type: type as never,
        amount: typeof amount === 'number' ? amount : undefined,
        timestamp: timestamp ? new Date(String(timestamp)) : undefined,
        metadata: metadata as Record<string, unknown> | undefined,
      });
      res.status(201).json({ ok: true, event: { ...event, timestamp: event.timestamp.toISOString() } });
    } catch (e: unknown) {
      throw new AppError(400, (e as Error).message, 'VALIDATION_ERROR');
    }
  }),
);

// Bulk track
customerHealthRouter.post(
  '/events/bulk',
  asyncHandler(async (req: Request, res: Response) => {
    const { events } = req.body as Record<string, unknown>;
    if (!Array.isArray(events)) throw new AppError(400, 'events array required', 'VALIDATION_ERROR');
    for (const ev of events as Array<Record<string, unknown>>) {
      if (typeof ev.customerId !== 'string' || typeof ev.type !== 'string') {
        throw new AppError(400, 'Each event needs customerId and type', 'VALIDATION_ERROR');
      }
    }
    try {
      customerHealthService.trackMany(
        (events as Array<Record<string, unknown>>).map((ev) => ({
          customerId: String(ev.customerId),
          type: String(ev.type) as never,
          amount: typeof ev.amount === 'number' ? ev.amount : undefined,
          timestamp: ev.timestamp ? new Date(String(ev.timestamp)) : undefined,
          metadata: ev.metadata as Record<string, unknown> | undefined,
        })),
      );
      res.json({ ok: true, count: events.length });
    } catch (e: unknown) {
      throw new AppError(400, (e as Error).message, 'VALIDATION_ERROR');
    }
  }),
);

// Distribution
customerHealthRouter.get(
  '/distribution',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ distribution: customerHealthService.getDistribution() });
  }),
);

// At-risk list
customerHealthRouter.get(
  '/at-risk',
  asyncHandler(async (req: Request, res: Response) => {
    const threshold = req.query.threshold ? Number(req.query.threshold) : 40;
    res.json({ customers: customerHealthService.listAtRisk(threshold) });
  }),
);

// Export CSV
customerHealthRouter.get(
  '/export',
  asyncHandler(async (_req: Request, res: Response) => {
    const csv = customerHealthService.exportCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="customer-health.csv"');
    res.send(csv);
  }),
);

// Get health for customer
customerHealthRouter.get(
  '/:customerId',
  asyncHandler(async (req: Request, res: Response) => {
    const health = customerHealthService.getHealth(req.params.customerId);
    res.json({ health });
  }),
);

// History
customerHealthRouter.get(
  '/:customerId/history',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ history: customerHealthService.getHistory(req.params.customerId) });
  }),
);

// Trend
customerHealthRouter.get(
  '/:customerId/trend',
  asyncHandler(async (req: Request, res: Response) => {
    const days = req.query.days ? Number(req.query.days) : 30;
    res.json({ trend: customerHealthService.getTrend(req.params.customerId, days) });
  }),
);
