/**
 * payments.ts — Issue #592
 *
 * Payment retry REST API routes.
 *
 * POST   /payments/retry                         — create a retry record
 * GET    /payments/retry/:id                     — get retry record by id
 * GET    /payments/retry/by-payment/:paymentId   — get retry by original payment
 * GET    /payments/retry/user/:userId            — list retries for a user
 * POST   /payments/retry/:id/execute             — manually trigger next attempt
 * POST   /payments/retry/:id/abandon             — abandon a retry
 * POST   /payments/retry/:id/outcome/:attemptId  — record attempt outcome
 * GET    /payments/retry/stats                   — aggregate statistics
 * GET    /payments/categorise                    — categorise a failure reason
 */

import { Router, type Request, type Response } from 'express';
import { paymentRetryService } from '../services/paymentRetry.js';

const router = Router();

// ── POST /payments/retry ─────────────────────────────────────────────────────

router.post('/retry', (req: Request, res: Response) => {
  const { paymentId, userId, amount, currency, failureReason, paymentMethodIds } = req.body as {
    paymentId?: string;
    userId?: string;
    amount?: number;
    currency?: string;
    failureReason?: string;
    paymentMethodIds?: string[];
  };

  if (!paymentId || !userId || amount == null || !currency || !failureReason || !paymentMethodIds) {
    return res.status(400).json({
      success: false,
      error: 'paymentId, userId, amount, currency, failureReason and paymentMethodIds are required',
    });
  }

  const result = paymentRetryService.createRetry({
    paymentId,
    userId,
    amount,
    currency,
    failureReason,
    paymentMethodIds,
  });

  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }

  return res.status(201).json({ success: true, data: result.value });
});

// ── GET /payments/retry/stats ────────────────────────────────────────────────

router.get('/retry/stats', (_req: Request, res: Response) => {
  return res.json({ success: true, data: paymentRetryService.getStats() });
});

// ── GET /payments/retry/by-payment/:paymentId ────────────────────────────────

router.get('/retry/by-payment/:paymentId', (req: Request, res: Response) => {
  const result = paymentRetryService.getRetryByPayment(req.params.paymentId);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 404).json({
      success: false,
      error: result.error.message,
    });
  }
  return res.json({ success: true, data: result.value });
});

// ── GET /payments/retry/user/:userId ─────────────────────────────────────────

router.get('/retry/user/:userId', (req: Request, res: Response) => {
  const retries = paymentRetryService.listUserRetries(req.params.userId);
  return res.json({ success: true, count: retries.length, data: retries });
});

// ── GET /payments/retry/:id ──────────────────────────────────────────────────

router.get('/retry/:id', (req: Request, res: Response) => {
  const result = paymentRetryService.getRetry(req.params.id);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 404).json({
      success: false,
      error: result.error.message,
    });
  }
  return res.json({ success: true, data: result.value });
});

// ── POST /payments/retry/:id/execute ─────────────────────────────────────────

router.post('/retry/:id/execute', (req: Request, res: Response) => {
  const { forceMethodIndex } = req.body as { forceMethodIndex?: number };
  const result = paymentRetryService.executeRetry(req.params.id, { forceMethodIndex });
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }
  return res.json({ success: true, data: result.value });
});

// ── POST /payments/retry/:id/abandon ─────────────────────────────────────────

router.post('/retry/:id/abandon', (req: Request, res: Response) => {
  const result = paymentRetryService.abandonRetry(req.params.id);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }
  return res.json({ success: true, data: result.value });
});

// ── POST /payments/retry/:id/outcome/:attemptId ───────────────────────────────

router.post('/retry/:id/outcome/:attemptId', (req: Request, res: Response) => {
  const { success, failureReason } = req.body as {
    success?: boolean;
    failureReason?: string;
  };

  if (success == null) {
    return res.status(400).json({ success: false, error: 'success (boolean) is required' });
  }

  const result = paymentRetryService.recordAttemptOutcome(
    req.params.id,
    req.params.attemptId,
    { success, failureReason },
  );

  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }

  return res.json({ success: true, data: result.value });
});

// ── GET /payments/categorise ──────────────────────────────────────────────────

router.get('/categorise', (req: Request, res: Response) => {
  const { reason } = req.query as { reason?: string };
  if (!reason) {
    return res.status(400).json({ success: false, error: 'reason query param is required' });
  }
  const info = paymentRetryService.categoriseFailure(reason);
  return res.json({ success: true, data: info });
});

export default router;
