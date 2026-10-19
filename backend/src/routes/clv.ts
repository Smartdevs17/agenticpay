// Customer Lifetime Value dashboard routes â€” Issue #943
// Mount at /api/v1/clv
import { Router, Request, Response } from 'express';
import { clvService } from '../services/clv.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

export const clvRouter = Router();
type PaymentStatus = 'completed' | 'pending' | 'failed' | 'refunded';
function parseMoney(value: unknown, field: string): number {
  const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new AppError(400, `${field} must be a non-negative number`, 'VALIDATION_ERROR');
  return n;
}
function parseDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(String(value)); if (isNaN(d.getTime())) throw new AppError(400, 'Invalid date', 'VALIDATION_ERROR');
  return d;
}
function parseStatus(value: unknown): PaymentStatus {
  if (typeof value !== 'string' || !['completed', 'pending', 'failed', 'refunded'].includes(value)) return 'completed';
  return value as PaymentStatus;
}
clvRouter.post('/payments', asyncHandler(async (req: Request, res: Response) => {
  const { customerId, amount, currency, status, timestamp, metadata } = req.body as Record<string, unknown>;
  if (typeof customerId !== 'string' || customerId.length === 0) throw new AppError(400, 'customerId is required', 'VALIDATION_ERROR');
  const entry = clvService.recordPayment({
    customerId, amount: parseMoney(amount, 'amount'), currency: typeof currency === 'string' ? currency : 'USD',
    status: parseStatus(status), timestamp: timestamp ? parseDate(timestamp) : undefined,
    metadata: metadata as Record<string, unknown> | undefined });
  res.status(201).json({ ok: true, payment: entry });
}));
clvRouter.get('/dashboard', asyncHandler(async (req: Request, res: Response) => {
  const asOf = parseDate(req.query.asOf); const limit = req.query.limit ? Number(req.query.limit) : undefined;
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) throw new AppError(400, 'limit must be a positive integer', 'VALIDATION_ERROR');
  res.json(clvService.dashboard({ asOf, limit }));
}));
clvRouter.get('/:customerId', asyncHandler(async (req: Request, res: Response) => {
  res.json(clvService.getCLV(req.params.customerId, parseDate(req.query.asOf)));
}));
clvRouter.get('/payments', asyncHandler(async (_req: Request, res: Response) => {
  const payments = clvService.list(); res.json({ payments, count: payments.length });
}));
