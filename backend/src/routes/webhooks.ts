import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
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

const rotateSecretSchema = z.object({
  secret: z.string().min(16),
});

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
