// Funnel Conversion Tracking routes — Issue #853
// Mount at /api/v1/funnels

import { Router, Request, Response } from 'express';
import { funnelTrackingService } from '../services/funnel-tracking.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

export const funnelTrackingRouter = Router();

// Create funnel
funnelTrackingRouter.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { id, name, description, steps, conversionWindowMs } = req.body as Record<string, unknown>;
    if (!name || typeof name !== 'string') throw new AppError(400, 'name is required', 'VALIDATION_ERROR');
    if (!Array.isArray(steps) || steps.length < 2) throw new AppError(400, 'steps must be array with at least 2 items', 'VALIDATION_ERROR');
    try {
      const funnel = funnelTrackingService.createFunnel({
        id: typeof id === 'string' ? id : undefined,
        name,
        description: typeof description === 'string' ? description : undefined,
        steps: steps as Array<{ id: string; name: string; description?: string }>,
        conversionWindowMs: typeof conversionWindowMs === 'number' ? conversionWindowMs : undefined,
      });
      res.status(201).json({ funnel });
    } catch (e: unknown) {
      throw new AppError(400, (e as Error).message, 'VALIDATION_ERROR');
    }
  }),
);

// List funnels
funnelTrackingRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ funnels: funnelTrackingService.listFunnels() });
  }),
);

// Get funnel by id
funnelTrackingRouter.get(
  '/:funnelId',
  asyncHandler(async (req: Request, res: Response) => {
    const funnel = funnelTrackingService.getFunnel(req.params.funnelId);
    if (!funnel) throw new AppError(404, 'Funnel not found', 'NOT_FOUND');
    res.json({ funnel });
  }),
);

// Update funnel
funnelTrackingRouter.patch(
  '/:funnelId',
  asyncHandler(async (req: Request, res: Response) => {
    const { name, description, conversionWindowMs } = req.body as Record<string, unknown>;
    const updated = funnelTrackingService.updateFunnel(req.params.funnelId, {
      name: typeof name === 'string' ? name : undefined,
      description: typeof description === 'string' ? description : undefined,
      conversionWindowMs: typeof conversionWindowMs === 'number' ? conversionWindowMs : undefined,
    });
    if (!updated) throw new AppError(404, 'Funnel not found', 'NOT_FOUND');
    res.json({ funnel: updated });
  }),
);

// Delete funnel
funnelTrackingRouter.delete(
  '/:funnelId',
  asyncHandler(async (req: Request, res: Response) => {
    const ok = funnelTrackingService.deleteFunnel(req.params.funnelId);
    if (!ok) throw new AppError(404, 'Funnel not found', 'NOT_FOUND');
    res.json({ ok: true });
  }),
);

// Track event
funnelTrackingRouter.post(
  '/:funnelId/track',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, stepId, timestamp, properties, sessionId } = req.body as Record<string, unknown>;
    if (typeof userId !== 'string' || typeof stepId !== 'string') {
      throw new AppError(400, 'userId and stepId are required', 'VALIDATION_ERROR');
    }
    try {
      const event = funnelTrackingService.track({
        funnelId: req.params.funnelId,
        userId,
        stepId,
        timestamp: timestamp ? new Date(String(timestamp)) : undefined,
        properties: properties as Record<string, unknown> | undefined,
        sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      });
      res.status(201).json({ ok: true, event: { ...event, timestamp: event.timestamp.toISOString() } });
    } catch (e: unknown) {
      throw new AppError(400, (e as Error).message, 'VALIDATION_ERROR');
    }
  }),
);

// Get funnel stats / conversion rates
funnelTrackingRouter.get(
  '/:funnelId/stats',
  asyncHandler(async (req: Request, res: Response) => {
    const { since, until, conversionWindowMs } = req.query as Record<string, string>;
    try {
      const stats = funnelTrackingService.getFunnelStats(req.params.funnelId, {
        since: since ? new Date(since) : undefined,
        until: until ? new Date(until) : undefined,
        conversionWindowMs: conversionWindowMs ? Number(conversionWindowMs) : undefined,
      });
      res.json({ stats });
    } catch (e: unknown) {
      throw new AppError(404, (e as Error).message, 'NOT_FOUND');
    }
  }),
);

// Get user journey
funnelTrackingRouter.get(
  '/:funnelId/journey/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    const journey = funnelTrackingService.getUserJourney(req.params.userId, req.params.funnelId);
    if (!journey) throw new AppError(404, 'No journey found for user', 'NOT_FOUND');
    res.json({ journey });
  }),
);

// Export CSV
funnelTrackingRouter.get(
  '/:funnelId/export',
  asyncHandler(async (req: Request, res: Response) => {
    const { since, until } = req.query as Record<string, string>;
    try {
      const csv = funnelTrackingService.exportCsv(req.params.funnelId, {
        since: since ? new Date(since) : undefined,
        until: until ? new Date(until) : undefined,
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="funnel-${req.params.funnelId}.csv"`);
      res.send(csv);
    } catch (e: unknown) {
      throw new AppError(404, (e as Error).message, 'NOT_FOUND');
    }
  }),
);
