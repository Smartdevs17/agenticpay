// Cross-border payments API routes — Issue #920
// Mounted at /api/v1/cross-border (see backend/docs/CROSS_BORDER_PAYMENTS.md)
//
// GET    /corridors            — supported corridors and their limits/fees
// POST   /quote                — { amount, sourceCurrency, targetCurrency, mode? } -> priced quote
// GET    /quotes/:id           — fetch a previously created quote
// POST   /payments             — { quoteId, senderId, recipientId, reference?, idempotencyKey? }
// GET    /payments             — ?senderId=&recipientId=&status=
// GET    /payments/:id         — fetch a single payment
// POST   /payments/:id/complete — { txHash? } settlement success callback
// POST   /payments/:id/fail     — { reason } settlement failure callback

import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import {
  crossBorderPaymentService,
  type CrossBorderPaymentStatus,
  type QuoteAmountMode,
} from '../services/cross-border/index.js';

export const crossBorderRouter = Router();

const PAYMENT_STATUSES: CrossBorderPaymentStatus[] = ['processing', 'completed', 'failed', 'cancelled'];

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(400, `${field} is required`, 'VALIDATION_ERROR');
  }
  return value;
}

function requirePositiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new AppError(400, `${field} must be a positive finite number`, 'VALIDATION_ERROR');
  }
  return value;
}

function unwrap<T>(result: { ok: boolean; value?: T; error?: { statusCode: number; message: string; code: string } }): T {
  if (!result.ok || result.value === undefined) {
    const error = result.error!;
    throw new AppError(error.statusCode, error.message, error.code);
  }
  return result.value;
}

crossBorderRouter.get(
  '/corridors',
  asyncHandler(async (_req, res) => {
    res.json({ data: crossBorderPaymentService.listCorridors() });
  }),
);

crossBorderRouter.post(
  '/quote',
  asyncHandler(async (req, res) => {
    const { amount, sourceCurrency, targetCurrency, mode } = req.body as Record<string, unknown>;

    if (mode !== undefined && mode !== 'source' && mode !== 'target') {
      throw new AppError(400, "mode must be 'source' or 'target'", 'VALIDATION_ERROR');
    }

    const result = await crossBorderPaymentService.createQuote({
      amount: requirePositiveNumber(amount, 'amount'),
      sourceCurrency: requireString(sourceCurrency, 'sourceCurrency'),
      targetCurrency: requireString(targetCurrency, 'targetCurrency'),
      mode: mode as QuoteAmountMode | undefined,
    });

    res.status(201).json({ data: unwrap(result) });
  }),
);

crossBorderRouter.get(
  '/quotes/:id',
  asyncHandler(async (req, res) => {
    res.json({ data: unwrap(crossBorderPaymentService.getQuote(String(req.params.id))) });
  }),
);

crossBorderRouter.post(
  '/payments',
  asyncHandler(async (req, res) => {
    const { quoteId, senderId, recipientId, reference, idempotencyKey } = req.body as Record<string, unknown>;

    const result = await crossBorderPaymentService.initiatePayment({
      quoteId: requireString(quoteId, 'quoteId'),
      senderId: requireString(senderId, 'senderId'),
      recipientId: requireString(recipientId, 'recipientId'),
      reference: typeof reference === 'string' ? reference : undefined,
      idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
    });

    res.status(201).json({ data: unwrap(result) });
  }),
);

crossBorderRouter.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const { senderId, recipientId, status } = req.query;

    if (status !== undefined && !PAYMENT_STATUSES.includes(status as CrossBorderPaymentStatus)) {
      throw new AppError(400, `status must be one of ${PAYMENT_STATUSES.join(', ')}`, 'VALIDATION_ERROR');
    }

    const result = crossBorderPaymentService.listPayments({
      senderId: typeof senderId === 'string' ? senderId : undefined,
      recipientId: typeof recipientId === 'string' ? recipientId : undefined,
      status: status ? (status as CrossBorderPaymentStatus) : undefined,
    });

    res.json({ data: unwrap(result) });
  }),
);

crossBorderRouter.get(
  '/payments/:id',
  asyncHandler(async (req, res) => {
    res.json({ data: unwrap(crossBorderPaymentService.getPayment(String(req.params.id))) });
  }),
);

crossBorderRouter.post(
  '/payments/:id/complete',
  asyncHandler(async (req, res) => {
    const { txHash } = req.body as Record<string, unknown>;
    res.json({
      data: unwrap(
        crossBorderPaymentService.completePayment(String(req.params.id), {
          txHash: typeof txHash === 'string' ? txHash : undefined,
        }),
      ),
    });
  }),
);

crossBorderRouter.post(
  '/payments/:id/fail',
  asyncHandler(async (req, res) => {
    const { reason } = req.body as Record<string, unknown>;
    res.json({
      data: unwrap(crossBorderPaymentService.failPayment(String(req.params.id), requireString(reason, 'reason'))),
    });
  }),
);
