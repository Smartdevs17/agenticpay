import { Router } from 'express';
import { webhookVerifiers, rawBodyCapture } from '../middleware/webhookVerification.js';
import { markWebhookProcessed } from '../services/webhooks/verification.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const webhookHandlersRouter = Router();

// Apply raw body capture middleware first (before JSON parsing)
webhookHandlersRouter.use(rawBodyCapture());

// Stripe webhooks
webhookHandlersRouter.post(
  '/stripe',
  webhookVerifiers.stripe,
  asyncHandler(async (req, res) => {
    const event = req.body;
    const verification = (req as any).webhookVerification;

    console.log(`Verified Stripe webhook: ${event.type}`, {
      eventId: event.id,
      verified: verification.isValid,
      timestamp: verification.timestamp,
    });

    // Process the webhook event
    // In a real implementation, this would trigger business logic
    // For now, just mark as processed
    const eventId = `stripe_${event.id}`;
    markWebhookProcessed(eventId);

    res.json({ received: true, event: event.type });
  }),
);

// PayPal webhooks
webhookHandlersRouter.post(
  '/paypal',
  webhookVerifiers.paypal,
  asyncHandler(async (req, res) => {
    const event = req.body;
    const verification = (req as any).webhookVerification;

    console.log(`Verified PayPal webhook: ${event.event_type}`, {
      eventId: event.id,
      verified: verification.isValid,
      timestamp: verification.timestamp,
    });

    // Process the webhook event
    const eventId = `paypal_${event.id}`;
    markWebhookProcessed(eventId);

    res.json({ received: true, event: event.event_type });
  }),
);

// GitHub webhooks
webhookHandlersRouter.post(
  '/github',
  webhookVerifiers.github,
  asyncHandler(async (req, res) => {
    const event = req.body;
    const eventType = req.headers['x-github-event'] as string;
    const verification = (req as any).webhookVerification;

    console.log(`Verified GitHub webhook: ${eventType}`, {
      deliveryId: req.headers['x-github-delivery'],
      verified: verification.isValid,
      timestamp: verification.timestamp,
    });

    // Process the webhook event
    const deliveryId = req.headers['x-github-delivery'] as string;
    const eventId = `github_${deliveryId}`;
    markWebhookProcessed(eventId);

    res.json({ received: true, event: eventType });
  }),
);

// Custom webhooks
webhookHandlersRouter.post(
  '/custom',
  webhookVerifiers.custom,
  asyncHandler(async (req, res) => {
    const event = req.body;
    const verification = (req as any).webhookVerification;

    console.log(`Verified custom webhook`, {
      verified: verification.isValid,
      timestamp: verification.timestamp,
    });

    // Process the webhook event
    const eventId = `custom_${Date.now()}`;
    markWebhookProcessed(eventId);

    res.json({ received: true });
  }),
);

// Test endpoint for webhook verification (no verification required)
webhookHandlersRouter.post(
  '/test',
  asyncHandler(async (req, res) => {
    console.log('Test webhook received:', req.body);
    res.json({ received: true, test: true });
  }),
);