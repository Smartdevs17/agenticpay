/**
 * split-payments.ts — Issue #917: Split payments between multiple recipients
 *
 * REST surface for split plans.
 *
 * POST /split-payments/plans                                  — create a plan
 * GET  /split-payments/plans?tenantId=&status=&merchantId=    — list plans
 * GET  /split-payments/plans/:id?tenantId=                    — fetch a plan
 * POST /split-payments/plans/:id/archive?tenantId=            — archive a plan
 * POST /split-payments/plans/:id/execute                      — execute a payment
 * GET  /split-payments/plans/:id/executions?tenantId=         — list executions
 * GET  /split-payments/plans/:id/summary?tenantId=            — execution summary
 * GET  /split-payments/plans/:id/preview?tenantId=&totalAmount= — preview split
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../middleware/errorHandler.js';
import { splitPaymentService } from '../services/split-payments/index.js';
import type { ServiceError } from '../lib/result.js';

export const splitPaymentsRouter = Router();
const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const statusSchema = z.enum(['active', 'archived']);

const recipientSchema = z.object({
  recipientId: z.string().min(1),
  walletAddress: z.string().min(1),
  percentage: z.number().positive().max(100),
  minimumAmount: z.number().nonnegative().optional(),
  label: z.string().min(1).optional(),
});

const createPlanSchema = z.object({
  tenantId: z.string().min(1),
  recipients: z.array(recipientSchema).min(1),
  platformFeePercentage: z.number().min(0).max(100).optional(),
  currency: z.string().length(3).optional(),
  merchantId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const executeSchema = z.object({
  tenantId: z.string().min(1).optional(),
  paymentId: z.string().min(1),
  totalAmount: z.number().positive(),
  currency: z.string().length(3).optional(),
});

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

// ── POST /split-payments/plans ───────────────────────────────────────────────

splitPaymentsRouter.post(
  '/plans',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Invalid payload', details: parsed.error.format() });
    }
    const result = await splitPaymentService.createPlan(parsed.data);
    if (!result.ok) {
      return sendResult(res, result);
    }
    return res.status(201).json({ success: true, data: result.value });
  }),
);

// ── GET /split-payments/plans ────────────────────────────────────────────────

splitPaymentsRouter.get(
  '/plans',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const status = statusSchema.safeParse(req.query.status).success
      ? (req.query.status as z.infer<typeof statusSchema>)
      : undefined;
    const result = await splitPaymentService.listPlans(tenantId, {
      status,
      merchantId: (req.query.merchantId as string) || undefined,
    });
    return sendResult(res, result);
  }),
);

// ── GET /split-payments/plans/:id/summary ────────────────────────────────────

splitPaymentsRouter.get(
  '/plans/:id/summary',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    return sendResult(res, await splitPaymentService.getExecutionSummary(tenantId, firstParam(req.params.id)));
  }),
);

// ── GET /split-payments/plans/:id/executions ─────────────────────────────────

splitPaymentsRouter.get(
  '/plans/:id/executions',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    return sendResult(res, await splitPaymentService.listExecutions(tenantId, firstParam(req.params.id)));
  }),
);

// ── GET /split-payments/plans/:id/preview ────────────────────────────────────

splitPaymentsRouter.get(
  '/plans/:id/preview',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const totalAmount = Number(req.query.totalAmount);
    return sendResult(res, await splitPaymentService.previewAllocation(tenantId, firstParam(req.params.id), totalAmount));
  }),
);

// ── GET /split-payments/plans/:id ────────────────────────────────────────────

splitPaymentsRouter.get(
  '/plans/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    return sendResult(res, await splitPaymentService.getPlan(tenantId, firstParam(req.params.id)));
  }),
);

// ── POST /split-payments/plans/:id/archive ───────────────────────────────────

splitPaymentsRouter.post(
  '/plans/:id/archive',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    return sendResult(res, await splitPaymentService.archivePlan(tenantId, firstParam(req.params.id)));
  }),
);

// ── POST /split-payments/plans/:id/execute ───────────────────────────────────

splitPaymentsRouter.post(
  '/plans/:id/execute',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = executeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Invalid payload', details: parsed.error.format() });
    }
    const tenantId = parsed.data.tenantId ?? ((req.query.tenantId as string) || undefined);
    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'tenantId is required' });
    }
    const result = await splitPaymentService.executeSplit(tenantId, firstParam(req.params.id), {
      paymentId: parsed.data.paymentId,
      totalAmount: parsed.data.totalAmount,
      currency: parsed.data.currency,
    });
    if (!result.ok) {
      return sendResult(res, result);
    }
    return res.status(201).json({ success: true, data: result.value });
  }),
);
