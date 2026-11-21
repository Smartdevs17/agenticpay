import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { whatsAppPaymentNotificationService } from '../services/whatsapp-payment-notifications.js';

export const whatsappNotificationRouter = Router();

/**
 * POST /api/v1/notifications/whatsapp/payment-success
 * Send WhatsApp payment success notification
 */
whatsappNotificationRouter.post(
  '/payment-success',
  asyncHandler(async (req: Request, res: Response) => {
    const { paymentId, userId, customerName, amount, currency, recipientPhone, transactionHash } = req.body;

    if (!paymentId || !userId || !customerName || amount == null || !currency) {
      throw new AppError(400, 'Missing required fields: paymentId, userId, customerName, amount, currency', 'VALIDATION_ERROR');
    }

    const result = await whatsAppPaymentNotificationService.notifyPaymentSuccess({
      paymentId,
      userId,
      customerName,
      amount: Number(amount),
      currency,
      status: 'succeeded',
      recipientPhone,
      transactionHash,
    });

    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    res.status(200).json(result);
  })
);

/**
 * POST /api/v1/notifications/whatsapp/payment-failed
 * Send WhatsApp payment failure notification
 */
whatsappNotificationRouter.post(
  '/payment-failed',
  asyncHandler(async (req: Request, res: Response) => {
    const { paymentId, userId, customerName, amount, currency, recipientPhone, errorMessage } = req.body;

    if (!paymentId || !userId || !customerName || amount == null || !currency) {
      throw new AppError(400, 'Missing required fields: paymentId, userId, customerName, amount, currency', 'VALIDATION_ERROR');
    }

    const result = await whatsAppPaymentNotificationService.notifyPaymentFailure({
      paymentId,
      userId,
      customerName,
      amount: Number(amount),
      currency,
      status: 'failed',
      recipientPhone,
      errorMessage,
    });

    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    res.status(200).json(result);
  })
);

/**
 * POST /api/v1/notifications/whatsapp/payment-refunded
 * Send WhatsApp payment refunded notification
 */
whatsappNotificationRouter.post(
  '/payment-refunded',
  asyncHandler(async (req: Request, res: Response) => {
    const { paymentId, userId, customerName, amount, currency, recipientPhone, refundId } = req.body;

    if (!paymentId || !userId || !customerName || amount == null || !currency) {
      throw new AppError(400, 'Missing required fields: paymentId, userId, customerName, amount, currency', 'VALIDATION_ERROR');
    }

    const result = await whatsAppPaymentNotificationService.notifyPaymentRefunded({
      paymentId,
      userId,
      customerName,
      amount: Number(amount),
      currency,
      status: 'refunded',
      recipientPhone,
      refundId,
    });

    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    res.status(200).json(result);
  })
);
