import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  wooCommercePaymentStatusUpdateSchema,
  type WooCommercePaymentStatus,
} from '../integrations/woocommerce/index.js';
import { wooCommerceService } from '../integrations/woocommerce/woocommerce-service.js';

export const wooCommerceRouter = Router();

const PAYMENT_STATUSES: WooCommercePaymentStatus[] = [
  'paid',
  'pending',
  'failed',
  'refunded',
];

function parseOrderId(value: string | string[] | undefined): number {
  const orderId = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new AppError(400, 'orderId must be a positive integer', 'VALIDATION_ERROR');
  }
  return orderId;
}

wooCommerceRouter.get('/status', (_req, res) => {
  res.json({ configured: wooCommerceService.isConfigured() });
});

/**
 * Build the payment draft used to open an AgenticPay checkout for an order.
 */
wooCommerceRouter.get(
  '/orders/:orderId/payment-draft',
  asyncHandler(async (req, res) => {
    const orderId = parseOrderId(req.params.orderId);
    const draft = await wooCommerceService.getPaymentDraft(orderId);
    res.json({ success: true, paymentDraft: draft });
  }),
);

/**
 * Push an AgenticPay payment status back to WooCommerce.
 */
wooCommerceRouter.post(
  '/orders/:orderId/status',
  validate(wooCommercePaymentStatusUpdateSchema),
  asyncHandler(async (req, res) => {
    const orderId = parseOrderId(req.params.orderId);
    const status = req.body.status as WooCommercePaymentStatus;

    if (!PAYMENT_STATUSES.includes(status)) {
      throw new AppError(
        400,
        `status must be one of: ${PAYMENT_STATUSES.join(', ')}`,
        'VALIDATION_ERROR',
      );
    }

    const order = await wooCommerceService.syncPaymentStatus(
      orderId,
      status,
      req.body.transactionId,
    );
    res.json({ success: true, order: { id: order.id, status: order.status } });
  }),
);

/**
 * WooCommerce webhook receiver. The raw body is preserved by
 * `webhookJsonParser` so the HMAC signature can be verified.
 */
wooCommerceRouter.post(
  '/webhooks',
  asyncHandler(async (req, res) => {
    const topic = String(req.headers['x-wc-webhook-topic'] ?? '');
    const signature = String(req.headers['x-wc-webhook-signature'] ?? '');
    const deliveryId = req.headers['x-wc-webhook-delivery-id'];
    const rawBody = req.rawBody;

    if (!topic || !signature || !rawBody) {
      throw new AppError(
        400,
        'Missing WooCommerce webhook topic, signature or body',
        'VALIDATION_ERROR',
      );
    }

    try {
      const event = wooCommerceService.processWebhook({
        rawBody,
        signature,
        topic,
        deliveryId: typeof deliveryId === 'string' ? deliveryId : undefined,
      });

      res.status(200).json({
        success: true,
        topic: event.topic,
        deliveryId: event.deliveryId,
        orderId: event.order.id,
        paymentDraft: event.paymentDraft,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Invalid WooCommerce webhook';
      throw new AppError(401, message, 'WEBHOOK_VERIFICATION_FAILED');
    }
  }),
);
