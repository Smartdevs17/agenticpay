// Cash flow forecasting routes â€” Issue #944
// Mount at /api/v1/cash-flow
import { Router, Request, Response } from 'express';
import { cashFlowService } from '../services/cash-flow.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

export const cashFlowRouter = Router();
function parseMoney(value: unknown, field: string): number {
  const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new AppError(400, `${field} must be a non-negative number`, 'VALIDATION_ERROR');
  return n;
}
function parseDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(String(value)); if (isNaN(d.getTime())) throw new AppError(400, 'Invalid date', 'VALIDATION_ERROR');
  return d;
}
cashFlowRouter.post('/inflow', asyncHandler(async (req: Request, res: Response) => {
  const { amount, currency, reference, metadata, timestamp } = req.body as Record<string, unknown>;
  const flow = cashFlowService.recordInflow(parseMoney(amount, 'amount'), {
    currency: typeof currency === 'string' ? currency : 'USD', reference: typeof reference === 'string' ? reference : undefined,
    metadata: metadata as Record<string, unknown> | undefined, timestamp: timestamp ? parseDate(timestamp) : undefined });
  res.status(201).json({ ok: true, flow });
}));
cashFlowRouter.post('/outflow', asyncHandler(async (req: Request, res: Response) => {
  const { amount, currency, reference, metadata, timestamp } = req.body as Record<string, unknown>;
  const flow = cashFlowService.recordOutflow(parseMoney(amount, 'amount'), {
    currency: typeof currency === 'string' ? currency : 'USD', reference: typeof reference === 'string' ? reference : undefined,
    metadata: metadata as Record<string, unknown> | undefined, timestamp: timestamp ? parseDate(timestamp) : undefined });
  res.status(201).json({ ok: true, flow });
}));
cashFlowRouter.get('/summary', asyncHandler(async (req: Request, res: Response) => {
  res.json(cashFlowService.summary({ since: parseDate(req.query.since), until: parseDate(req.query.until),
    currency: typeof req.query.currency === 'string' ? req.query.currency : undefined }));
}));
cashFlowRouter.get('/forecast', asyncHandler(async (req: Request, res: Response) => {
  const horizon = req.query.horizon ? Number(req.query.horizon) : undefined;
  if (horizon !== undefined && (!Number.isFinite(horizon) || horizon < 1 || horizon > 60)) throw new AppError(400, 'horizon must be between 1 and 60', 'VALIDATION_ERROR');
  res.json(cashFlowService.forecast({ horizon, asOf: parseDate(req.query.asOf), currency: typeof req.query.currency === 'string' ? req.query.currency : undefined }));
}));
cashFlowRouter.get('/flows', asyncHandler(async (_req: Request, res: Response) => {
  const flows = cashFlowService.list(); res.json({ flows, count: flows.length });
}));
