import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { razorpayClient } from '../integrations/razorpay/index.js';
import type { RazorpayWebhookPayload } from '../integrations/razorpay/types.js';

export const razorpayRouter = Router();

/**
 * POST /api/v1/razorpay/orders
 * Create a new Razorpay payment order
 */
razorpayRouter.post(
  '/orders',
  asyncHandler(async (req: Request, res: Response) => {
    const { amount, currency, receipt, notes, paymentCapture } = req.body;

    if (amount == null || !currency) {
      throw new AppError(400, 'amount and currency are required', 'VALIDATION_ERROR');
    }

    const order = await razorpayClient.createOrder({
      amount: Number(amount),
      currency,
      receipt,
      notes,
      paymentCapture,
    });

    res.status(201).json({ success: true, data: order });
  })
);

/**
 * GET /api/v1/razorpay/orders/:id
 * Retrieve details of an order
 */
razorpayRouter.get(
  '/orders/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const order = await razorpayClient.getOrder(id);
    res.json({ success: true, data: order });
  })
);

/**
 * GET /api/v1/razorpay/payments/:id
 * Retrieve details of a payment
 */
razorpayRouter.get(
  '/payments/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const payment = await razorpayClient.getPayment(id);
    res.json({ success: true, data: payment });
  })
);

/**
 * POST /api/v1/razorpay/payments/:id/capture
 * Capture an authorized payment
 */
razorpayRouter.post(
  '/payments/:id/capture',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { amount, currency } = req.body;

    if (amount == null) {
      throw new AppError(400, 'amount is required to capture payment', 'VALIDATION_ERROR');
    }

    const payment = await razorpayClient.capturePayment(id, Number(amount), currency);
    res.json({ success: true, data: payment });
  })
);

/**
 * POST /api/v1/razorpay/verify-signature
 * Verify checkout payment signature
 */
razorpayRouter.post(
  '/verify-signature',
  asyncHandler(async (req: Request, res: Response) => {
    const { orderId, paymentId, signature } = req.body;

    if (!orderId || !paymentId || !signature) {
      throw new AppError(400, 'orderId, paymentId, and signature are required', 'VALIDATION_ERROR');
    }

    const isValid = razorpayClient.verifyPaymentSignature({
      orderId,
      paymentId,
      signature,
    });

    res.json({ success: true, verified: isValid });
  })
);

/**
 * POST /api/v1/razorpay/refunds
 * Create a payment refund
 */
razorpayRouter.post(
  '/refunds',
  asyncHandler(async (req: Request, res: Response) => {
    const { paymentId, amount, notes, speed } = req.body;

    if (!paymentId) {
      throw new AppError(400, 'paymentId is required', 'VALIDATION_ERROR');
    }

    const refund = await razorpayClient.createRefund({
      paymentId,
      amount: amount != null ? Number(amount) : undefined,
      notes,
      speed,
    });

    res.status(201).json({ success: true, data: refund });
  })
);

/**
 * POST /api/v1/razorpay/webhook
 * Razorpay webhook event listener with HMAC signature verification
 */
razorpayRouter.post(
  '/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    const signature = req.headers['x-razorpay-signature'] as string | undefined;
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (webhookSecret && signature) {
      const rawBody = JSON.stringify(req.body);
      const isValid = razorpayClient.verifyWebhookSignature(rawBody, signature, webhookSecret);
      if (!isValid) {
        throw new AppError(401, 'Invalid Razorpay webhook signature', 'UNAUTHORIZED');
      }
    }

    const event = req.body as RazorpayWebhookPayload;
    console.log(`[Razorpay Webhook] Received event: ${event.event || 'unknown'}`);

    res.status(200).json({ received: true, event: event.event });
  })
);
