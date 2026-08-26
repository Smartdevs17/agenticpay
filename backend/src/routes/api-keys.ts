import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { apiKeyService } from '../services/api-keys.js';
import { z } from 'zod';

export const apiKeysRouter = Router();

const createApiKeySchema = z.object({
  name: z.string().min(2).max(64),
  tier: z.enum(['free', 'pro', 'enterprise']).optional(),
  scopes: z.array(z.string()).optional(),
  expiresInDays: z.number().int().positive().max(365).optional(),
});

apiKeysRouter.post(
  '/',
  validate(createApiKeySchema),
  asyncHandler(async (req, res) => {
    const userId = req.headers['x-user-id'] as string || 'anonymous';
    const { record, rawKey } = apiKeyService.createApiKey({ ...req.body, userId });
    res.status(201).json({
      data: record,
      rawKey,
      message: 'API key created. Store the raw key securely — it will not be shown again.',
    });
  })
);

apiKeysRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.headers['x-user-id'] as string || 'anonymous';
    const keys = apiKeyService.listApiKeys(userId);
    res.json({ data: keys, count: keys.length });
  })
);

apiKeysRouter.get(
  '/usage',
  asyncHandler(async (req, res) => {
    const userId = req.headers['x-user-id'] as string || 'anonymous';
    const windowMs = req.query.window ? Number(req.query.window) : 60_000;
    const usage = apiKeyService.getUsageSummary(userId, windowMs);
    res.json({ data: usage });
  })
);

apiKeysRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const key = apiKeyService.getApiKey(id);
    if (!key) throw new AppError(404, 'API key not found', 'NOT_FOUND');
    res.json({ data: key });
  })
);

apiKeysRouter.post(
  '/:id/revoke',
  asyncHandler(async (req, res) => {
    const userId = req.headers['x-user-id'] as string || 'anonymous';
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const key = apiKeyService.revokeApiKey(id, userId);
    if (!key) throw new AppError(404, 'API key not found', 'NOT_FOUND');
    res.json({ data: key });
  })
);

apiKeysRouter.post(
  '/:id/rotate',
  asyncHandler(async (req, res) => {
    const userId = req.headers['x-user-id'] as string || 'anonymous';
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = apiKeyService.rotateApiKey(id, userId);
    if (!result) throw new AppError(404, 'API key not found', 'NOT_FOUND');
    res.json({
      data: result.record,
      rawKey: result.rawKey,
      message: 'API key rotated. Store the raw key securely.',
    });
  })
);

apiKeysRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.headers['x-user-id'] as string || 'anonymous';
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const deleted = apiKeyService.deleteApiKey(id, userId);
    if (!deleted) throw new AppError(404, 'API key not found', 'NOT_FOUND');
    res.status(204).send();
  })
);
