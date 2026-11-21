/**
 * installments.ts — Issue #919: BNPL installment plans
 *
 * REST surface for Buy-Now-Pay-Later financing.
 *
 * POST /installments/plans                                        — create a plan
 * GET  /installments/plans?tenantId=&status=&customerId=          — list plans
 * GET  /installments/plans/:id?tenantId=                          — fetch a plan
 * GET  /installments/plans/:id/summary?tenantId=                  — repayment summary
 * POST /installments/plans/:id/installments/:index/pay            — record a collection
 * POST /installments/plans/:id/installments/:index/fail           — record a failure
 * POST /installments/plans/:id/cancel                             — cancel the plan
 * POST /installments/sweep                                        — flag overdue installments
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../middleware/errorHandler.js';
import { bnplInstallmentService } from '../services/payments/installments/index.js';
import type { ServiceError } from '../lib/result.js';

export const installmentsRouter = Router();

const frequencySchema = z.enum(['weekly', 'biweekly', 'monthly']);
const planStatusSchema = z.enum(['active', 'completed', 'cancelled', 'defaulted']);

const createPlanSchema = z.object({
  tenantId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  installmentCount: z.number().int().positive(),
  frequency: frequencySchema.optional(),
  downPayment: z.number().nonnegative().optional(),
  customerId: z.string().min(1).optional(),
  merchantId: z.string().min(1).optional(),
  startDate: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const scheduleInputSchema = z.object({
  paymentId: z.string().min(1).optional(),
  paidAt: z.string().datetime().optional(),
});

const failSchema = z.object({
  reason: z.string().min(1).max(280),
});

const cancelSchema = z.object({
  reason: z.string().max(280).optional(),
});

const sweepSchema = z.object({
  tenantId: z.string().min(1),
  at: z.string().datetime().optional(),
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

// ── POST /installments/plans ─────────────────────────────────────────────────

installmentsRouter.post(
  '/plans',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Invalid payload', details: parsed.error.format() });
    }
    const result = await bnplInstallmentService.createPlan(parsed.data);
    if (!result.ok) {
      return sendResult(res, result);
    }
    return res.status(201).json({ success: true, data: result.value });
  }),
);

// ── GET /installments/plans ──────────────────────────────────────────────────

installmentsRouter.get(
  '/plans',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const status = planStatusSchema.safeParse(req.query.status).success
      ? (req.query.status as z.infer<typeof planStatusSchema>)
      : undefined;
    const result = await bnplInstallmentService.listPlans(tenantId, {
      status,
      customerId: (req.query.customerId as string) || undefined,
      merchantId: (req.query.merchantId as string) || undefined,
    });
    return sendResult(res, result);
  }),
);

// ── GET /installments/plans/:id/summary ──────────────────────────────────────

installmentsRouter.get(
  '/plans/:id/summary',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const result = await bnplInstallmentService.getSummary(tenantId, req.params.id);
    return sendResult(res, result);
  }),
);

// ── GET /installments/plans/:id ──────────────────────────────────────────────

installmentsRouter.get(
  '/plans/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const result = await bnplInstallmentService.getPlan(tenantId, req.params.id);
    return sendResult(res, result);
  }),
);

// ── POST /installments/plans/:id/installments/:index/pay ─────────────────────

installmentsRouter.post(
  '/plans/:id/installments/:index/pay',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const installmentIndex = Number(req.params.index);
    if (!Number.isInteger(installmentIndex) || installmentIndex < 1) {
      return res.status(400).json({ success: false, error: 'installment index must be a positive integer' });
    }

    const parsed = scheduleInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Invalid payload', details: parsed.error.format() });
    }

    const result = await bnplInstallmentService.payInstallment(tenantId, req.params.id, {
      installmentIndex,
      ...parsed.data,
    });
    return sendResult(res, result);
  }),
);

// ── POST /installments/plans/:id/installments/:index/fail ────────────────────

installmentsRouter.post(
  '/plans/:id/installments/:index/fail',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const installmentIndex = Number(req.params.index);
    if (!Number.isInteger(installmentIndex) || installmentIndex < 1) {
      return res.status(400).json({ success: false, error: 'installment index must be a positive integer' });
    }

    const parsed = failSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Invalid payload', details: parsed.error.format() });
    }

    const result = await bnplInstallmentService.markInstallmentFailed(
      tenantId,
      req.params.id,
      installmentIndex,
      parsed.data.reason,
    );
    return sendResult(res, result);
  }),
);

// ── POST /installments/plans/:id/cancel ──────────────────────────────────────

installmentsRouter.post(
  '/plans/:id/cancel',
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;

    const parsed = cancelSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Invalid payload', details: parsed.error.format() });
    }

    const result = await bnplInstallmentService.cancelPlan(tenantId, req.params.id, parsed.data.reason);
    return sendResult(res, result);
  }),
);

// ── POST /installments/sweep ─────────────────────────────────────────────────

installmentsRouter.post(
  '/sweep',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = sweepSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Invalid payload', details: parsed.error.format() });
    }
    const result = await bnplInstallmentService.sweepOverdue(parsed.data.tenantId, parsed.data.at ?? new Date());
    return sendResult(res, result);
  }),
);
