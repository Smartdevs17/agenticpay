import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
// Webhook verification services (signature verification feature)
import {
  getAllWebhookSecrets,
  createWebhookSecret,
  rotateWebhookSecret as rotateWebhookSecretByProvider,
  deactivateWebhookSecret,
  getWebhookEvents,
  getQueuedWebhooks,
  retryWebhook,
  markWebhookProcessed,
  WebhookProvider,
} from '../services/webhooks/verification.js';
// Webhook delivery services
import {
  enqueueWebhookEvent,
  getWebhookDelivery,
  listDeadLetterQueue,
  listWebhookConfigs,
  listWebhookDeliveries,
  retryWebhookDeliveryManually,
  rotateWebhookSecret,
  startWebhookWorker,
  upsertWebhookConfig,
} from '../services/webhooks.js';

export const webhooksRouter = Router();

// Schemas for webhook configuration
const webhookConfigSchema = z.object({
  merchantId: z.string().min(1),
  url: z.string().url(),
  secret: z.string().min(16),
  enabled: z.boolean().optional(),
});

const webhookEventSchema = z.object({
  merchantId: z.string().min(1),
  type: z.string().min(1),
  payload: z.record(z.unknown()),
  idempotencyKey: z.string().min(1).optional(),
});

// Schemas for signature verification
const createSecretSchema = z.object({
  provider: z.enum(['stripe', 'paypal', 'github', 'custom']),
  secret: z.string().min(32, 'Secret must be at least 32 characters'),
  expiresAt: z.string().optional(),
});

const rotateSecretByProviderSchema = z.object({
  newSecret: z.string().min(32, 'Secret must be at least 32 characters'),
  gracePeriodHours: z.number().min(1).max(168).default(24), // 1 hour to 1 week
});

const rotateSecretSchema = z.object({
  secret: z.string().min(16),
});

// Webhook configuration routes
webhooksRouter.post(
  '/configs',
  validate(webhookConfigSchema),
  asyncHandler(async (req, res) => {
    const config = upsertWebhookConfig(req.body);
    startWebhookWorker();
    res.status(201).json(config);
  })
);

webhooksRouter.get(
  '/configs',
  asyncHandler(async (_req, res) => {
    res.json({ data: listWebhookConfigs() });
  })
);

webhooksRouter.post(
  '/configs/:configId/rotate-secret',
  validate(rotateSecretSchema),
  asyncHandler(async (req, res) => {
    const rotated = rotateWebhookSecret(req.params.configId, req.body.secret);
    if (!rotated) throw new AppError(404, 'Webhook config not found', 'NOT_FOUND');
    res.json(rotated);
  })
);

// Admin routes for webhook secret management (signature verification)
webhooksRouter.get(
  '/secrets',
  asyncHandler(async (_req, res) => {
    const secrets = getAllWebhookSecrets();
    res.json({ secrets, total: secrets.length });
  })
);

webhooksRouter.post(
  '/secrets',
  validate(createSecretSchema),
  asyncHandler(async (req, res) => {
    const secret = createWebhookSecret(
      req.body.provider,
      req.body.secret,
      req.body.expiresAt
    );
    res.status(201).json(secret);
  })
);

webhooksRouter.post(
  '/secrets/:provider/rotate',
  validate(rotateSecretByProviderSchema),
  asyncHandler(async (req, res) => {
    const secret = rotateWebhookSecretByProvider(
      req.params.provider as WebhookProvider,
      req.body.newSecret,
      req.body.gracePeriodHours
    );
    res.json(secret);
  })
);

webhooksRouter.delete(
  '/secrets/:secretId',
  asyncHandler(async (req, res) => {
    const success = deactivateWebhookSecret(req.params.secretId);
    if (!success) {
      throw new AppError(404, 'Webhook secret not found', 'NOT_FOUND');
    }
    res.status(204).send();
  })
);

// Webhook event management
webhooksRouter.post(
  '/events',
  validate(webhookEventSchema),
  asyncHandler(async (req, res) => {
    const result = enqueueWebhookEvent(req.body);
    if (!result.accepted) {
      throw new AppError(409, result.reason ?? 'Webhook event rejected', 'WEBHOOK_REJECTED', result.delivery);
    }
    res.status(202).json(result.delivery);
  })
);

webhooksRouter.get(
  '/events',
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const events = getWebhookEvents(limit);
    res.json({ events, total: events.length });
  })
);

webhooksRouter.get(
  '/events/queued',
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const events = getQueuedWebhooks(limit);
    res.json({ events, total: events.length });
  })
);

webhooksRouter.post(
  '/events/:eventId/retry',
  asyncHandler(async (req, res) => {
    const result = retryWebhook(req.params.eventId);
    if (!result) {
      throw new AppError(404, 'Webhook event not found or already processed', 'NOT_FOUND');
    }
    res.json(result);
  })
);

webhooksRouter.post(
  '/events/:eventId/process',
  asyncHandler(async (req, res) => {
    const success = markWebhookProcessed(req.params.eventId);
    if (!success) {
      throw new AppError(404, 'Webhook event not found', 'NOT_FOUND');
    }
    res.json({ success: true });
  })
);

// Webhook delivery tracking
webhooksRouter.get(
  '/deliveries',
  asyncHandler(async (_req, res) => {
    res.json({ data: listWebhookDeliveries() });
  })
);

webhooksRouter.get(
  '/deliveries/:deliveryId',
  asyncHandler(async (req, res) => {
    const delivery = getWebhookDelivery(req.params.deliveryId);
    if (!delivery) throw new AppError(404, 'Delivery not found', 'NOT_FOUND');
    res.json(delivery);
  })
);

webhooksRouter.post(
  '/deliveries/:deliveryId/retry',
  asyncHandler(async (req, res) => {
    const retried = retryWebhookDeliveryManually(req.params.deliveryId);
    if (!retried) throw new AppError(404, 'Delivery not found', 'NOT_FOUND');
    res.json(retried);
  })
);

webhooksRouter.get(
  '/dead-letter',
  asyncHandler(async (_req, res) => {
    res.json({ data: listDeadLetterQueue() });
  })
);