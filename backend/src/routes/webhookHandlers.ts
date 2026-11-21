import { Router } from 'express';
import { webhookVerifiers, webhookJsonParser } from '../middleware/webhookVerification.js';
import { markWebhookProcessed } from '../services/webhooks/verification.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { createModuleLogger } from '../middleware/logger.js';

export const webhookHandlersRouter = Router();
const webhookLog = createModuleLogger('webhooks');

webhookHandlersRouter.use(webhookJsonParser);

webhookHandlersRouter.post(
  '/stripe',
  webhookVerifiers.stripe,
  asyncHandler(async (req, res) => {
    const event = req.body as { id?: string; type?: string };
    webhookLog.info(
      { eventId: event.id, type: event.type, verified: req.webhookVerification?.isValid },
      'Stripe webhook received',
    );
    if (event.id) markWebhookProcessed(`stripe_${event.id}`);
    res.json({ received: true, event: event.type });
  }),
);

webhookHandlersRouter.post(
  '/paypal',
  webhookVerifiers.paypal,
  asyncHandler(async (req, res) => {
    const event = req.body as { id?: string; event_type?: string };
    webhookLog.info({ eventId: event.id, type: event.event_type }, 'PayPal webhook received');
    if (event.id) markWebhookProcessed(`paypal_${event.id}`);
    res.json({ received: true, event: event.event_type });
  }),
);

webhookHandlersRouter.post(
  '/github',
  webhookVerifiers.github,
  asyncHandler(async (req, res) => {
    const eventType = req.headers['x-github-event'] as string;
    const deliveryId = req.headers['x-github-delivery'] as string;
    webhookLog.info({ deliveryId, eventType }, 'GitHub webhook received');
    markWebhookProcessed(`github_${deliveryId}`);
    res.json({ received: true, event: eventType });
  }),
);

webhookHandlersRouter.post(
  '/custom',
  webhookVerifiers.custom,
  asyncHandler(async (req, res) => {
    webhookLog.info({ verified: req.webhookVerification?.isValid }, 'Custom webhook received');
    const eventId = req.webhookVerification?.eventId ?? `custom_${Date.now()}`;
    markWebhookProcessed(eventId);
    res.json({ received: true });
  }),
);

webhookHandlersRouter.post(
  '/test',
  asyncHandler(async (req, res) => {
    webhookLog.debug({ body: req.body }, 'Test webhook received');
    res.json({ received: true, test: true });
  }),
);
