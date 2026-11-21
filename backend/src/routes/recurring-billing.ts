/**
 * recurring-billing.ts — Issue #918: Recurring payment schedules with
 * cron-based billing
 *
 * REST surface for recurring schedules.
 *
 * POST /recurring-payments/schedules                     — create a schedule
 * GET  /recurring-payments/schedules?tenantId=&status=   — list schedules
 * GET  /recurring-payments/schedules/:id?tenantId=       — fetch a schedule
 * GET  /recurring-payments/schedules/:id/upcoming?tenantId=&count= — next runs
 * GET  /recurring-payments/schedules/:id/invoices?tenantId= — generated invoices
 * POST /recurring-payments/schedules/:id/pause?tenantId=  — pause billing
 * POST /recurring-payments/schedules/:id/resume?tenantId= — resume billing
 * POST /recurring-payments/schedules/:id/cancel?tenantId= — cancel billing
 * POST /recurring-payments/schedules/:id/reschedule      — change cadence
 * POST /recurring-payments/run-due                       — bill all due schedules
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../middleware/errorHandler.js';
import { recurringBillingService } from '../services/recurring-billing/index.js';
import type { ServiceError } from '../lib/result.js';

export const recurringBillingRouter = Router();
const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const presetSchema = z.enum(['hourly', 'daily', 'weekly', 'monthly', 'yearly']);
const statusSchema = z.enum(['active', 'paused', 'cancelled', 'completed']);

const createSchema = z
  .object({
    tenantId: z.string().min(1),
    customerId: z.string().min(1),
    amount: z.number().positive(),
    currency: z.string().length(3).optional(),
    cronExpression: z.string().min(1).optional(),
    preset: presetSchema.optional(),
    timezone: z.string().min(1).optional(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    maxRuns: z.number().int().positive().optional(),
    merchantId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine((value) => !(value.cronExpression && value.preset), {
    message: 'Provide either cronExpression or preset, not both',
    path: ['cronExpression'],
  });

const rescheduleSchema = z.object({
  cronExpression: z.string().min(1).optional(),
  preset: presetSchema.optional(),
  timezone: z.string().min(1).optional(),
});

const cancelSchema = z.object({ reason: z.string().max(280).optional() });
const runDueSchema = z.object({ at: z.string().datetime().optional() });

function requireTenant(req: Request, res: Response): string | null {
  const tenantId = (req.query.tenantId ?? req.body?.tenantId) as string | undefined;
  if (!tenantId) {
    res.status(400).json({ success: false, error: 'tenantId is required' });
    return null;
  }
  return tenantId;
}

function sendResult<T>(res: Response, result: { ok: true; value: T } | { ok: false; error: ServiceError }) {
  if (result.ok) {
    return res.json({ success: true, data: result.value });
  }
  return res.status(result.error.statusCode ?? 400).json({
    success: false,
    error: result.error.message,
    code: result.error.code,
  });
}

// ── POST /recurring-payments/schedules ───────────────────────────────────────

recurringBillingRouter.post(
  '/schedules',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Invalid payload', details: parsed.error.format() });
    }
    const result = await recurringBillingService.createSchedule(parsed.data);
    if (!result.ok) {
      return sendResult(res, result);
    }
    return res.status(201).json({ success: true, data: result.value });
  }),
);

// ── GET /recurring-payments/schedules ────────────────────────────────────────

recurringBillingRouter.get(
  '/schedules',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const status = statusSchema.safeParse(req.query.status).success
      ? (req.query.status as z.infer<typeof statusSchema>)
      : undefined;
    const result = await recurringBillingService.listSchedules(tenantId, {
      status,
      customerId: (req.query.customerId as string) || undefined,
      merchantId: (req.query.merchantId as string) || undefined,
    });
    return sendResult(res, result);
  }),
);

// ── GET /recurring-payments/schedules/:id/upcoming ───────────────────────────

recurringBillingRouter.get(
  '/schedules/:id/upcoming',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const count = req.query.count ? Number(req.query.count) : 5;
    const result = await recurringBillingService.previewUpcoming(tenantId, firstParam(req.params.id), count);
    return sendResult(res, result);
  }),
);

// ── GET /recurring-payments/schedules/:id/invoices ───────────────────────────

recurringBillingRouter.get(
  '/schedules/:id/invoices',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const result = await recurringBillingService.listInvoices(tenantId, firstParam(req.params.id));
    return sendResult(res, result);
  }),
);

// ── GET /recurring-payments/schedules/:id ────────────────────────────────────

recurringBillingRouter.get(
  '/schedules/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const result = await recurringBillingService.getSchedule(tenantId, firstParam(req.params.id));
    return sendResult(res, result);
  }),
);

// ── Lifecycle transitions ────────────────────────────────────────────────────

recurringBillingRouter.post(
  '/schedules/:id/pause',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    return sendResult(res, await recurringBillingService.pauseSchedule(tenantId, firstParam(req.params.id)));
  }),
);

recurringBillingRouter.post(
  '/schedules/:id/resume',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    return sendResult(res, await recurringBillingService.resumeSchedule(tenantId, firstParam(req.params.id)));
  }),
);

recurringBillingRouter.post(
  '/schedules/:id/cancel',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const parsed = cancelSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Invalid payload', details: parsed.error.format() });
    }
    return sendResult(res, await recurringBillingService.cancelSchedule(tenantId, firstParam(req.params.id), parsed.data.reason));
  }),
);

recurringBillingRouter.post(
  '/schedules/:id/reschedule',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const parsed = rescheduleSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Invalid payload', details: parsed.error.format() });
    }
    return sendResult(res, await recurringBillingService.reschedule(tenantId, firstParam(req.params.id), parsed.data));
  }),
);

// ── POST /recurring-payments/run-due ─────────────────────────────────────────

recurringBillingRouter.post(
  '/run-due',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = runDueSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Invalid payload', details: parsed.error.format() });
    }
    const result = await recurringBillingService.runDue(parsed.data.at ?? new Date());
    return sendResult(res, result);
  }),
);
