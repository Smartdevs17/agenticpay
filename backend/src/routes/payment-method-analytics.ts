// Payment method usage analytics routes â€” Issue #942
// Mount at /api/v1/payment-methods/analytics
import { Router, Request, Response } from 'express';
import { paymentMethodAnalyticsService } from '../services/payment-method-analytics.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

export const paymentMethodAnalyticsRouter = Router();
function parseDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(String(value)); if (isNaN(d.getTime())) throw new AppError(400, 'Invalid date', 'VALIDATION_ERROR');
  return d;
}
paymentMethodAnalyticsRouter.post('/usage', asyncHandler(async (req: Request, res: Response) => {
  const { method, amount, currency, status, timestamp, metadata } = req.body as Record<string, unknown>;
  if (typeof method !== 'string' || method.length === 0) throw new AppError(400, 'method is required', 'VALIDATION_ERROR');
  const n = Number(amount); if (!Number.isFinite(n) || n < 0) throw new AppError(400, 'amount must be a non-negative number', 'VALIDATION_ERROR');
  const validStatus = ['success', 'failure', 'pending'].includes(String(status ?? '')) ? (status as 'success' | 'failure' | 'pending') : 'success';
  const entry = paymentMethodAnalyticsService.recordUsage({
    method, amount: n, currency: typeof currency === 'string' ? currency : 'USD', status: validStatus,
    timestamp: timestamp ? parseDate(timestamp) : undefined, metadata: metadata as Record<string, unknown> | undefined });
  res.status(201).json({ ok: true, event: entry });
}));
paymentMethodAnalyticsRouter.get('/analytics', asyncHandler(async (req: Request, res: Response) => {
  res.json(paymentMethodAnalyticsService.getAnalytics({ since: parseDate(req.query.since) }));
}));
paymentMethodAnalyticsRouter.get('/:method/stats', asyncHandler(async (req: Request, res: Response) => {
  res.json(paymentMethodAnalyticsService.getMethodStats(req.params.method));
}));
paymentMethodAnalyticsRouter.get('/usage', asyncHandler(async (_req: Request, res: Response) => {
  const events = paymentMethodAnalyticsService.list(); res.json({ events, count: events.length });
}));
