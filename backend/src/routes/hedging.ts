import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { hedgingService } from '../services/hedging.js';

export const hedgingRouter = Router();

const firstParam = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

const thresholdSchema = z.object({
  baseCurrency: z.string().min(2).max(10).toUpperCase(),
  quoteCurrency: z.string().min(2).max(10).toUpperCase(),
  upperBound: z.number().positive().optional(),
  lowerBound: z.number().positive().optional(),
  notionalAmount: z.number().positive(),
  instrument: z.enum(['forward', 'option', 'spot']),
  lockDurationSeconds: z.number().int().positive(),
});

const createScheduleSchema = z.object({
  merchantId: z.string().min(1),
  thresholds: z.array(thresholdSchema).min(1),
  pollIntervalMs: z.number().int().min(5000).optional(),
});

const executeHedgeSchema = z.object({
  merchantId: z.string().min(1),
  baseCurrency: z.string().min(2).max(10).toUpperCase(),
  quoteCurrency: z.string().min(2).max(10).toUpperCase(),
  notionalAmount: z.number().positive(),
  instrument: z.enum(['forward', 'option', 'spot']),
  lockDurationSeconds: z.number().int().positive(),
  triggerType: z.enum(['threshold', 'scheduled', 'manual']).optional(),
});

const updateScheduleSchema = z.object({
  thresholds: z.array(thresholdSchema).min(1).optional(),
  pollIntervalMs: z.number().int().min(5000).optional(),
  enabled: z.boolean().optional(),
});

// ── Rates ────────────────────────────────────────────────────────────────────

/** GET /api/v1/hedging/rates?base=USD&quote=EUR */
hedgingRouter.get(
  '/rates',
  asyncHandler(async (req, res) => {
    const base = firstParam(req.query.base as string).toUpperCase();
    const quote = firstParam(req.query.quote as string).toUpperCase();
    if (!base || !quote) throw new AppError(400, 'base and quote query params required', 'VALIDATION_ERROR');
    const snapshot = await hedgingService.getRate(base, quote);
    res.json(snapshot);
  })
);

/** GET /api/v1/hedging/rates/history?base=USD&quote=EUR&limit=50 */
hedgingRouter.get(
  '/rates/history',
  asyncHandler(async (req, res) => {
    const base = firstParam(req.query.base as string).toUpperCase();
    const quote = firstParam(req.query.quote as string).toUpperCase();
    const limit = Number(req.query.limit) || 100;
    if (!base || !quote) throw new AppError(400, 'base and quote query params required', 'VALIDATION_ERROR');
    res.json({ history: hedgingService.getRateHistory(base, quote, limit) });
  })
);

// ── Schedules ────────────────────────────────────────────────────────────────

/** POST /api/v1/hedging/schedules */
hedgingRouter.post(
  '/schedules',
  asyncHandler(async (req, res) => {
    const parsed = createScheduleSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, parsed.error.message, 'VALIDATION_ERROR');
    const schedule = hedgingService.createSchedule(parsed.data);
    res.status(201).json(schedule);
  })
);

/** GET /api/v1/hedging/schedules?merchantId=xxx */
hedgingRouter.get(
  '/schedules',
  asyncHandler(async (req, res) => {
    const merchantId = firstParam(req.query.merchantId as string);
    if (!merchantId) throw new AppError(400, 'merchantId query param required', 'VALIDATION_ERROR');
    res.json({ items: hedgingService.listSchedules(merchantId) });
  })
);

/** GET /api/v1/hedging/schedules/:scheduleId */
hedgingRouter.get(
  '/schedules/:scheduleId',
  asyncHandler(async (req, res) => {
    const schedule = hedgingService.getSchedule(firstParam(req.params.scheduleId));
    if (!schedule) throw new AppError(404, 'Schedule not found', 'NOT_FOUND');
    res.json(schedule);
  })
);

/** PATCH /api/v1/hedging/schedules/:scheduleId */
hedgingRouter.patch(
  '/schedules/:scheduleId',
  asyncHandler(async (req, res) => {
    const parsed = updateScheduleSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, parsed.error.message, 'VALIDATION_ERROR');
    const updated = hedgingService.updateSchedule(firstParam(req.params.scheduleId), parsed.data);
    if (!updated) throw new AppError(404, 'Schedule not found', 'NOT_FOUND');
    res.json(updated);
  })
);

/** DELETE /api/v1/hedging/schedules/:scheduleId */
hedgingRouter.delete(
  '/schedules/:scheduleId',
  asyncHandler(async (req, res) => {
    const deleted = hedgingService.deleteSchedule(firstParam(req.params.scheduleId));
    if (!deleted) throw new AppError(404, 'Schedule not found', 'NOT_FOUND');
    res.status(204).send();
  })
);

// ── Positions ────────────────────────────────────────────────────────────────

/** POST /api/v1/hedging/positions — manual hedge execution */
hedgingRouter.post(
  '/positions',
  asyncHandler(async (req, res) => {
    const parsed = executeHedgeSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, parsed.error.message, 'VALIDATION_ERROR');
    const position = await hedgingService.executeHedge(parsed.data);
    res.status(201).json(position);
  })
);

/** GET /api/v1/hedging/positions?merchantId=xxx */
hedgingRouter.get(
  '/positions',
  asyncHandler(async (req, res) => {
    const merchantId = firstParam(req.query.merchantId as string);
    if (!merchantId) throw new AppError(400, 'merchantId query param required', 'VALIDATION_ERROR');
    res.json({ items: hedgingService.listPositions(merchantId) });
  })
);

/** GET /api/v1/hedging/positions/:positionId */
hedgingRouter.get(
  '/positions/:positionId',
  asyncHandler(async (req, res) => {
    const position = hedgingService.getPosition(firstParam(req.params.positionId));
    if (!position) throw new AppError(404, 'Position not found', 'NOT_FOUND');
    res.json(position);
  })
);

/** POST /api/v1/hedging/positions/:positionId/close */
hedgingRouter.post(
  '/positions/:positionId/close',
  asyncHandler(async (req, res) => {
    const position = await hedgingService.closePosition(firstParam(req.params.positionId));
    if (!position) throw new AppError(404, 'Position not found or not active', 'NOT_FOUND');
    res.json(position);
  })
);

/** POST /api/v1/hedging/positions/:positionId/cancel — manual override */
hedgingRouter.post(
  '/positions/:positionId/cancel',
  asyncHandler(async (req, res) => {
    const position = hedgingService.cancelPosition(firstParam(req.params.positionId));
    if (!position) throw new AppError(404, 'Position not found or not active', 'NOT_FOUND');
    res.json(position);
  })
);

// ── P&L ──────────────────────────────────────────────────────────────────────

/** GET /api/v1/hedging/pnl?merchantId=xxx */
hedgingRouter.get(
  '/pnl',
  asyncHandler(async (req, res) => {
    const merchantId = firstParam(req.query.merchantId as string);
    if (!merchantId) throw new AppError(400, 'merchantId query param required', 'VALIDATION_ERROR');
    const report = await hedgingService.getPnlReport(merchantId);
    res.json(report);
  })
);

// ── Audit ────────────────────────────────────────────────────────────────────

/** GET /api/v1/hedging/audit?merchantId=xxx */
hedgingRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const merchantId = firstParam(req.query.merchantId as string) || undefined;
    res.json({ entries: hedgingService.getHedgeAudit(merchantId) });
  })
);
