// Multi-currency Profit & Loss routes â€” Issue #941
// Mount at /api/v1/reports/pnl
import { Router, Request, Response } from 'express';
import { pnlService } from '../services/pnl.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

export const pnlRouter = Router();
function parseMoney(value: unknown, field: string): number {
  const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new AppError(400, `${field} must be a non-negative number`, 'VALIDATION_ERROR');
  return n;
}
function parseDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(String(value)); if (isNaN(d.getTime())) throw new AppError(400, 'Invalid date', 'VALIDATION_ERROR');
  return d;
}
function resolveCurrency(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new AppError(400, 'currency is required', 'VALIDATION_ERROR');
  return value.toUpperCase();
}
pnlRouter.post('/revenue', asyncHandler(async (req: Request, res: Response) => {
  const { amount, currency, reference, metadata, timestamp } = req.body as Record<string, unknown>;
  const entry = pnlService.recordRevenue(parseMoney(amount, 'amount'), resolveCurrency(currency), {
    reference: typeof reference === 'string' ? reference : undefined,
    metadata: metadata as Record<string, unknown> | undefined, timestamp: timestamp ? parseDate(timestamp) : undefined });
  res.status(201).json({ ok: true, entry });
}));
pnlRouter.post('/cost', asyncHandler(async (req: Request, res: Response) => {
  const { amount, currency, reference, metadata, timestamp } = req.body as Record<string, unknown>;
  const entry = pnlService.recordCost(parseMoney(amount, 'amount'), resolveCurrency(currency), {
    reference: typeof reference === 'string' ? reference : undefined,
    metadata: metadata as Record<string, unknown> | undefined, timestamp: timestamp ? parseDate(timestamp) : undefined });
  res.status(201).json({ ok: true, entry });
}));
pnlRouter.post('/fx', asyncHandler(async (req: Request, res: Response) => {
  const { from, to, rate } = req.body as Record<string, unknown>;
  if (typeof from !== 'string' || typeof to !== 'string') throw new AppError(400, 'from and to currencies are required', 'VALIDATION_ERROR');
  const r = Number(rate); if (!Number.isFinite(r) || r <= 0) throw new AppError(400, 'rate must be a positive number', 'VALIDATION_ERROR');
  pnlService.setFXRate(from, to, r); res.json({ ok: true, from: from.toUpperCase(), to: to.toUpperCase(), rate: r });
}));
pnlRouter.get('/report', asyncHandler(async (req: Request, res: Response) => {
  res.json(pnlService.report({ since: parseDate(req.query.since), until: parseDate(req.query.until) }));
}));
pnlRouter.get('/ledger', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ entries: pnlService.list(), count: pnlService.count() });
}));
