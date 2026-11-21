import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  zapierSubscribeInputSchema,
  zapierUnsubscribeInputSchema,
  zapierTriggerTypeSchema,
  zapierCreateInvoiceSchema,
  zapierCreatePaymentLinkSchema,
  zapierIssueRefundSchema,
  zapierVerifyPaymentSchema,
  ZapierTriggerType,
} from '../integrations/zapier/types.js';
import { zapierWebhookService } from '../integrations/zapier/zapier-webhook-service.js';
import { verifyZapierProviderWebhook } from '../services/webhooks/providers.js';

export const zapierRouter = Router();

// ============================================================================
// REST Hook Subscription Endpoints (Zapier Lifecycle)
// ============================================================================

/**
 * Zapier calls this when a Zap is turned ON.
 * Registers a REST hook subscription.
 */
zapierRouter.post(
  '/hooks/subscribe',
  validate(zapierSubscribeInputSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const subscription = await zapierWebhookService.subscribe(req.body);
    res.status(201).json({
      id: subscription.id,
      hookUrl: subscription.hookUrl,
      event: subscription.event,
      status: subscription.status,
      createdAt: subscription.createdAt,
    });
  })
);

/**
 * Zapier calls this when a Zap is turned OFF or deleted.
 * Unsubscribes by ID.
 */
zapierRouter.delete(
  '/hooks/unsubscribe/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await zapierWebhookService.unsubscribe(req.params.id);
    if (!result.success) {
      throw new AppError(404, 'Zapier subscription not found', 'NOT_FOUND');
    }
    res.status(200).json({ success: true, message: 'Subscription removed' });
  })
);

/**
 * Alternative unsubscribe endpoint accepting body { id, hookUrl }.
 */
zapierRouter.post(
  '/hooks/unsubscribe',
  validate(zapierUnsubscribeInputSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await zapierWebhookService.unsubscribe(req.body.id, req.body.hookUrl);
    if (!result.success) {
      throw new AppError(404, 'Zapier subscription not found', 'NOT_FOUND');
    }
    res.status(200).json({ success: true, unsubscribedCount: result.unsubscribedCount });
  })
);

/**
 * List all active Zapier REST hook subscriptions.
 */
zapierRouter.get(
  '/hooks',
  asyncHandler(async (req: Request, res: Response) => {
    const merchantId = req.query.merchantId as string | undefined;
    const subscriptions = zapierWebhookService.listSubscriptions(merchantId);
    res.json({
      subscriptions,
      total: subscriptions.length,
    });
  })
);

// ============================================================================
// Triggers & Sample Data (Zapier Field Mapping & Testing)
// ============================================================================

/**
 * List all supported Zapier triggers.
 */
zapierRouter.get(
  '/triggers',
  asyncHandler(async (_req: Request, res: Response) => {
    const triggers = [
      {
        event: 'payment.succeeded',
        label: 'Payment Succeeded',
        description: 'Triggers when a Stellar or fiat payment completes successfully.',
      },
      {
        event: 'payment.failed',
        label: 'Payment Failed',
        description: 'Triggers when a payment attempt fails or is rejected.',
      },
      {
        event: 'invoice.created',
        label: 'Invoice Created',
        description: 'Triggers when a new invoice is issued.',
      },
      {
        event: 'invoice.paid',
        label: 'Invoice Paid',
        description: 'Triggers when an invoice is fully settled.',
      },
      {
        event: 'dispute.opened',
        label: 'Dispute Opened',
        description: 'Triggers when a buyer files a dispute or chargeback.',
      },
      {
        event: 'dispute.resolved',
        label: 'Dispute Resolved',
        description: 'Triggers when a dispute is resolved.',
      },
      {
        event: 'refund.created',
        label: 'Refund Created',
        description: 'Triggers when a refund is initiated.',
      },
      {
        event: 'refund.completed',
        label: 'Refund Completed',
        description: 'Triggers when a refund completes.',
      },
      {
        event: 'webhook.test',
        label: 'Webhook Test / Ping',
        description: 'Connection test trigger to verify Zapier webhook delivery.',
      },
    ];
    res.json({ triggers });
  })
);

/**
 * Fetch sample payload for a trigger event (used by Zapier to configure fields).
 */
zapierRouter.get(
  '/triggers/:event/sample',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = zapierTriggerTypeSchema.safeParse(req.params.event);
    if (!parseResult.success) {
      throw new AppError(
        400,
        `Invalid event type '${req.params.event}'. Supported: ${zapierTriggerTypeSchema.options.join(', ')}`,
        'INVALID_EVENT_TYPE'
      );
    }
    const sample = zapierWebhookService.getSamplePayload(parseResult.data as ZapierTriggerType);
    // Zapier sample endpoints typically return an array of objects
    res.json([sample]);
  })
);

/**
 * Dispatch a manual test trigger to all active subscribers or a specific payload.
 */
zapierRouter.post(
  '/triggers/:event/test',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = zapierTriggerTypeSchema.safeParse(req.params.event);
    if (!parseResult.success) {
      throw new AppError(
        400,
        `Invalid event type '${req.params.event}'`,
        'INVALID_EVENT_TYPE'
      );
    }

    const payload = req.body && Object.keys(req.body).length > 0
      ? req.body
      : zapierWebhookService.getSamplePayload(parseResult.data as ZapierTriggerType);

    const results = await zapierWebhookService.dispatchTrigger(
      parseResult.data as ZapierTriggerType,
      payload
    );

    res.json({
      event: parseResult.data,
      dispatchedCount: results.length,
      deliveries: results,
    });
  })
);

// ============================================================================
// Actions (Zapier Inbound Action Execution)
// ============================================================================

/**
 * List supported Zapier actions.
 */
zapierRouter.get(
  '/actions',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      actions: [
        {
          key: 'create_invoice',
          label: 'Create Invoice',
          endpoint: '/api/v1/zapier/actions/invoice',
          method: 'POST',
        },
        {
          key: 'create_payment_link',
          label: 'Create Payment Link',
          endpoint: '/api/v1/zapier/actions/payment-link',
          method: 'POST',
        },
        {
          key: 'issue_refund',
          label: 'Issue Refund',
          endpoint: '/api/v1/zapier/actions/refund',
          method: 'POST',
        },
        {
          key: 'verify_payment',
          label: 'Verify Payment',
          endpoint: '/api/v1/zapier/actions/verify',
          method: 'POST',
        },
      ],
    });
  })
);

/**
 * Action: Create Invoice
 */
zapierRouter.post(
  '/actions/invoice',
  validate(zapierCreateInvoiceSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const invoice = await zapierWebhookService.executeCreateInvoice(req.body);
    res.status(201).json(invoice);
  })
);

/**
 * Action: Create Payment Link
 */
zapierRouter.post(
  '/actions/payment-link',
  validate(zapierCreatePaymentLinkSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const paymentLink = await zapierWebhookService.executeCreatePaymentLink(req.body);
    res.status(201).json(paymentLink);
  })
);

/**
 * Action: Issue Refund
 */
zapierRouter.post(
  '/actions/refund',
  validate(zapierIssueRefundSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const refund = await zapierWebhookService.executeIssueRefund(req.body);
    res.status(200).json(refund);
  })
);

/**
 * Action: Verify Payment
 */
zapierRouter.post(
  '/actions/verify',
  validate(zapierVerifyPaymentSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await zapierWebhookService.executeVerifyPayment(req.body);
    res.status(200).json(result);
  })
);

// ============================================================================
// Inbound Webhook Receiver (Zapier to AgenticPay Webhook Catch)
// ============================================================================

/**
 * Receives incoming webhooks from Zapier.
 * If signature headers are provided, validates with HMAC-SHA256.
 */
zapierRouter.post(
  '/webhooks',
  asyncHandler(async (req: Request, res: Response) => {
    const rawBody = (req as any).rawBody ?? JSON.stringify(req.body ?? {});

    // If signature headers are present, verify
    if (req.headers['x-zapier-signature'] || req.headers['x-signature']) {
      const verification = verifyZapierProviderWebhook(req, rawBody);
      if (!verification.isValid) {
        throw new AppError(
          401,
          `Zapier webhook signature verification failed: ${verification.error}`,
          'ZAPIER_VERIFICATION_FAILED'
        );
      }
    }

    const eventId = (req.headers['x-zapier-event-id'] as string) || `zap_in_${Date.now()}`;
    res.status(200).json({
      received: true,
      eventId,
      processedAt: new Date().toISOString(),
      payload: req.body,
    });
  })
);
