import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { quotaManagerService } from '../services/keys/quota-manager.js';
import { rotateApiKeyWithGracePeriod, settleGracePeriod } from '../services/keys/rotation.js';
import { randomBytes, createHash } from 'node:crypto';

export const apiKeysRouter = Router();

function resolveTenant(req: any): string {
  return (req.headers['x-tenant-id'] as string) ?? 'default';
}

apiKeysRouter.post('/', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const { description, expiresAt } = req.body as { description?: string; expiresAt?: string };
  const keyId = `ak_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const key = await prisma.apiKey.create({
    data: {
      tenantId,
      keyId,
      description,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
  });
  res.status(201).json({ keyId: key.keyId, description: key.description });
}));

apiKeysRouter.get('/', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const keys = await prisma.apiKey.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { usage: true } },
      quota: true,
    },
  });
  const settled = await Promise.all(keys.map((key) => settleGracePeriod(key)));
  res.json({ keys: settled });
}));

apiKeysRouter.get('/:keyId', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const key = await prisma.apiKey.findUnique({
    where: { keyId: req.params.keyId },
    include: { quota: true },
  });
  if (!key || key.tenantId !== tenantId) throw new AppError(404, 'API key not found', 'KEY_NOT_FOUND');
  const settled = await settleGracePeriod(key);
  res.json(settled);
}));

apiKeysRouter.delete('/:keyId', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const key = await prisma.apiKey.findUnique({ where: { keyId: req.params.keyId } });
  if (!key || key.tenantId !== tenantId) throw new AppError(404, 'API key not found', 'KEY_NOT_FOUND');
  await prisma.apiKey.update({ where: { keyId: req.params.keyId }, data: { isActive: false, revokedAt: new Date() } });
  res.json({ success: true });
}));

apiKeysRouter.get('/:keyId/usage', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const key = await prisma.apiKey.findUnique({ where: { keyId: req.params.keyId } });
  if (!key || key.tenantId !== tenantId) throw new AppError(404, 'API key not found', 'KEY_NOT_FOUND');
  const settled = await settleGracePeriod(key);
  const summary = await quotaManagerService.getUsageSummary(req.params.keyId);
  res.json({
    ...summary,
    rotation: {
      rotatedAt: settled.rotatedAt,
      gracePeriodEndsAt: settled.gracePeriodEndsAt,
      predecessorKeyId: settled.predecessorKeyId,
      successorKeyId: settled.successorKeyId,
      inGracePeriod: Boolean(
        settled.isActive && settled.gracePeriodEndsAt && settled.gracePeriodEndsAt.getTime() > Date.now(),
      ),
    },
  });
}));

apiKeysRouter.get('/:keyId/usage/daily', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const key = await prisma.apiKey.findUnique({ where: { keyId: req.params.keyId } });
  if (!key || key.tenantId !== tenantId) throw new AppError(404, 'API key not found', 'KEY_NOT_FOUND');
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 90);
  const daily = await quotaManagerService.getDailyUsage(req.params.keyId as string, days);
  res.json({ keyId: req.params.keyId, days, daily });
}));

apiKeysRouter.put('/:keyId/quota', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const key = await prisma.apiKey.findUnique({ where: { keyId: req.params.keyId } });
  if (!key || key.tenantId !== tenantId) throw new AppError(404, 'API key not found', 'KEY_NOT_FOUND');
  const quota = await quotaManagerService.updateQuota(req.params.keyId, req.body);
  res.json(quota);
}));

apiKeysRouter.get('/analytics/summary', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const summary = await quotaManagerService.getTenantUsageSummary(tenantId);
  res.json(summary);
}));

apiKeysRouter.post('/:keyId/rotate', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const key = await prisma.apiKey.findUnique({ where: { keyId: req.params.keyId } });
  if (!key || key.tenantId !== tenantId) throw new AppError(404, 'API key not found', 'KEY_NOT_FOUND');
  if (!key.isActive) throw new AppError(409, 'API key is not active', 'KEY_INACTIVE');

  const { gracePeriodHours } = req.body as { gracePeriodHours?: number };
  const { previousKey, newKey, gracePeriodEndsAt } = await rotateApiKeyWithGracePeriod({
    tenantId,
    keyId: key.keyId,
    gracePeriodHours,
  });

  res.status(201).json({
    keyId: newKey.keyId,
    description: newKey.description,
    rotatedFrom: previousKey.keyId,
    gracePeriod: {
      predecessorKeyId: previousKey.keyId,
      gracePeriodEndsAt,
    },
  });
}));

apiKeysRouter.post('/:keyId/revoke', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const key = await prisma.apiKey.findUnique({ where: { keyId: req.params.keyId } });
  if (!key || key.tenantId !== tenantId) throw new AppError(404, 'API key not found', 'KEY_NOT_FOUND');
  await prisma.apiKey.update({ where: { keyId: req.params.keyId }, data: { isActive: false, revokedAt: new Date() } });
  res.json({ success: true, keyId: req.params.keyId, status: 'revoked' });
}));
