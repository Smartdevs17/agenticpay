import { Router } from 'express';
import {
  getAllWebhookSecrets,
  createWebhookSecret,
  rotateWebhookSecret,
  deactivateWebhookSecret,
  getWebhookEvents,
  getQueuedWebhooks,
  retryWebhook,
  markWebhookProcessed,
  WebhookProvider,
} from '../services/webhooks/verification.js';
import { validate } from './validate.js';
import { AppError, asyncHandler } from './errorHandler.js';
import { z } from 'zod';

const createSecretSchema = z.object({
  provider: z.enum(['stripe', 'paypal', 'github', 'custom']),
  secret: z.string().min(32, 'Secret must be at least 32 characters'),
  expiresAt: z.string().optional(),
});

const rotateSecretSchema = z.object({
  newSecret: z.string().min(32, 'Secret must be at least 32 characters'),
  gracePeriodHours: z.number().min(1).max(168).default(24), // 1 hour to 1 week
});

export const webhooksRouter = Router();

// Admin routes for webhook secret management
webhooksRouter.get(
  '/secrets',
  asyncHandler(async (_req, res) => {
    const secrets = getAllWebhookSecrets();
    res.json({ secrets, total: secrets.length });
  }),
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
  }),
);

webhooksRouter.post(
  '/secrets/:provider/rotate',
  validate(rotateSecretSchema),
  asyncHandler(async (req, res) => {
    const secret = rotateWebhookSecret(
      req.params.provider as WebhookProvider,
      req.body.newSecret,
      req.body.gracePeriodHours
    );
    res.json(secret);
  }),
);

webhooksRouter.delete(
  '/secrets/:secretId',
  asyncHandler(async (req, res) => {
    const success = deactivateWebhookSecret(req.params.secretId);
    if (!success) {
      throw new AppError(404, 'Webhook secret not found', 'NOT_FOUND');
    }
    res.status(204).send();
  }),
);

// Webhook event management
webhooksRouter.get(
  '/events',
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const events = getWebhookEvents(limit);
    res.json({ events, total: events.length });
  }),
);

webhooksRouter.get(
  '/events/queued',
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const events = getQueuedWebhooks(limit);
    res.json({ events, total: events.length });
  }),
);

webhooksRouter.post(
  '/events/:eventId/retry',
  asyncHandler(async (req, res) => {
    const result = retryWebhook(req.params.eventId);
    if (!result) {
      throw new AppError(404, 'Webhook event not found or already processed', 'NOT_FOUND');
    }
    res.json(result);
  }),
);

webhooksRouter.post(
  '/events/:eventId/process',
  asyncHandler(async (req, res) => {
    const success = markWebhookProcessed(req.params.eventId);
    if (!success) {
      throw new AppError(404, 'Webhook event not found', 'NOT_FOUND');
    }
    res.json({ success: true });
  }),
);