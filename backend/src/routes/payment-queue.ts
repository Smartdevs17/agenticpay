/**
 * Payment Queue Routes
 * /api/v1/queue/payments
 */

import { Router } from 'express';
import { paymentQueue, PaymentStatus, CreatePaymentInput } from '../queue/payment-queue.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

export const paymentQueueRouter = Router();

const VALID_STATUSES: PaymentStatus[] = [
  'pending', 'executing', 'executed', 'failed', 'cancelled', 'missed',
];

/**
 * POST /api/v1/queue/payments
 * Schedule a new payment
 */
paymentQueueRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { from, to, amount, asset, trigger, notifyUrl } = req.body as CreatePaymentInput;

    if (!from || !to || !amount || !trigger?.type) {
      throw new AppError(400, 'Missing required fields: from, to, amount, trigger', 'INVALID_REQUEST');
    }

    if (!['time', 'block', 'price'].includes(trigger.type)) {
      throw new AppError(400, 'trigger.type must be one of: time, block, price', 'INVALID_REQUEST');
    }

    if (trigger.type === 'time' && !trigger.executeAt) {
      throw new AppError(400, 'trigger.executeAt is required for time triggers', 'INVALID_REQUEST');
    }
    if (trigger.type === 'block' && typeof trigger.blockHeight !== 'number') {
      throw new AppError(400, 'trigger.blockHeight (number) is required for block triggers', 'INVALID_REQUEST');
    }
    if (trigger.type === 'price' && typeof trigger.maxPrice !== 'number') {
      throw new AppError(400, 'trigger.maxPrice (number) is required for price triggers', 'INVALID_REQUEST');
    }

    const payment = paymentQueue.schedule({ from, to, amount, asset, trigger, notifyUrl });

    res.status(202).json({ data: payment });
  })
);

/**
 * GET /api/v1/queue/payments
 * List scheduled payments, optionally filtered by status
 */
paymentQueueRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;

    if (status && !VALID_STATUSES.includes(status as PaymentStatus)) {
      throw new AppError(400, `Invalid status: ${status}`, 'INVALID_REQUEST');
    }

    const payments = paymentQueue.list(status as PaymentStatus | undefined);
    res.json({ data: payments, count: payments.length });
  })
);

/**
 * GET /api/v1/queue/payments/stats
 * Queue statistics
 */
paymentQueueRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    res.json({ data: paymentQueue.stats() });
  })
);

/**
 * GET /api/v1/queue/payments/:id
 * Get a single scheduled payment
 */
paymentQueueRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const payment = paymentQueue.get(req.params.id);
    if (!payment) throw new AppError(404, `Payment not found: ${req.params.id}`, 'NOT_FOUND');
    res.json({ data: payment });
  })
);

/**
 * POST /api/v1/queue/payments/:id/cancel
 * Cancel a pending payment
 */
paymentQueueRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const cancelled = paymentQueue.cancel(req.params.id);
    if (!cancelled) {
      throw new AppError(400, 'Payment cannot be cancelled (not found or not pending)', 'INVALID_STATE');
    }
    res.json({ data: paymentQueue.get(req.params.id) });
  })
);

/**
 * DELETE /api/v1/queue/payments/:id
 * Delete a payment record
 */
paymentQueueRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const deleted = paymentQueue.delete(req.params.id);
    if (!deleted) throw new AppError(404, `Payment not found: ${req.params.id}`, 'NOT_FOUND');
    res.status(204).send();
  })
);
