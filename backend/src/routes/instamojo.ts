import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { instamojoClient } from '../integrations/instamojo/index.js';
import type { InstamojoWebhookPayload } from '../integrations/instamojo/types.js';

export const instamojoRouter = Router();

/**
 * POST /api/v1/instamojo/payment-requests
 * Create an Instamojo payment request link
 */
instamojoRouter.post(
  '/payment-requests',
  asyncHandler(async (req: Request, res: Response) => {
    const { purpose, amount, buyerName, email, phone, redirectUrl, webhookUrl } = req.body;

    if (!purpose || amount == null) {
      throw new AppError(400, 'purpose and amount are required', 'VALIDATION_ERROR');
    }

    const result = await instamojoClient.createPaymentRequest({
      purpose,
      amount,
      buyerName,
      email,
      phone,
      redirectUrl,
      webhookUrl,
    });

    res.status(201).json({ success: true, data: result });
  })
);

/**
 * GET /api/v1/instamojo/payment-requests/:id
 * Retrieve payment request details by ID
 */
instamojoRouter.get(
  '/payment-requests/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const result = await instamojoClient.getPaymentRequest(id);
    res.json({ success: true, data: result });
  })
);

/**
 * GET /api/v1/instamojo/payments/:id
 * Retrieve payment details by payment ID
 */
instamojoRouter.get(
  '/payments/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const result = await instamojoClient.getPayment(id);
    res.json({ success: true, data: result });
  })
);

/**
 * POST /api/v1/instamojo/refunds
 * Initiate an Instamojo refund
 */
instamojoRouter.post(
  '/refunds',
  asyncHandler(async (req: Request, res: Response) => {
    const { paymentId, type, body, refundAmount } = req.body;

    if (!paymentId || !body) {
      throw new AppError(400, 'paymentId and body are required', 'VALIDATION_ERROR');
    }

    const result = await instamojoClient.createRefund({
      paymentId,
      type: type || 'RFD',
      body,
      refundAmount,
    });

    res.status(201).json({ success: true, data: result });
  })
);

/**
 * POST /api/v1/instamojo/webhook
 * Instamojo webhook listener verifying MAC signature
 */
instamojoRouter.post(
  '/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    const payload = req.body as InstamojoWebhookPayload;
    const privateSalt = process.env.INSTAMOJO_PRIVATE_SALT;

    // If private salt is configured, verify MAC
    if (privateSalt && payload.mac) {
      const isValid = instamojoClient.verifyWebhookMac(payload, privateSalt);
      if (!isValid) {
        throw new AppError(401, 'Invalid Instamojo webhook MAC signature', 'UNAUTHORIZED');
      }
    }

    // Process payment status
    console.log(`[Instamojo Webhook] Received status ${payload.status} for payment ${payload.payment_id}`);

    res.status(200).json({ received: true, paymentId: payload.payment_id, status: payload.status });
  })
);
