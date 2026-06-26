// Signing key management routes — Issue #510
// GET    /api/v1/developers/signing-keys           — list keys for tenant
// POST   /api/v1/developers/signing-keys           — create a new key
// DELETE /api/v1/developers/signing-keys/:keyId    — revoke a key
// POST   /api/v1/developers/signing-keys/:keyId/rotate — rotate (revoke + create)

import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { auditService } from '../services/auditService.js';
import { invalidateKeyCache } from '../middleware/hmac-auth.js';

export const signingKeysRouter = Router();

function resolveTenant(req: any): string {
  return (req.headers['x-tenant-id'] as string) ?? 'default';
}

function generateKeyId(): string {
  return `sk_${randomBytes(12).toString('hex')}`;
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

// GET /api/v1/developers/signing-keys
signingKeysRouter.get('/', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const keys = await prisma.signingKey.findMany({
    where: { tenantId },
    select: {
      keyId: true,
      description: true,
      isActive: true,
      createdAt: true,
      revokedAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ keys });
}));

// POST /api/v1/developers/signing-keys
signingKeysRouter.post('/', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const { description, expiresAt } = req.body as { description?: string; expiresAt?: string };

  const keyId = generateKeyId();
  const rawSecret = randomBytes(32).toString('hex');

  await prisma.signingKey.create({
    data: {
      tenantId,
      keyId,
      secretHash: hashSecret(rawSecret),
      description,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    },
  });

  void auditService.logAction({
    action: 'signing_key.created',
    resource: 'signing_key',
    details: { keyId, tenantId },
  });

  // Return the raw secret only once — client must store it
  res.status(201).json({ keyId, secret: rawSecret, description, expiresAt });
}));

// DELETE /api/v1/developers/signing-keys/:keyId
signingKeysRouter.delete('/:keyId', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const { keyId } = req.params;

  const existing = await prisma.signingKey.findUnique({ where: { keyId } });
  if (!existing || existing.tenantId !== tenantId) {
    throw new AppError(404, 'Signing key not found', 'KEY_NOT_FOUND');
  }

  await prisma.signingKey.update({
    where: { keyId },
    data: { isActive: false, revokedAt: new Date() },
  });

  invalidateKeyCache(keyId);

  void auditService.logAction({
    action: 'signing_key.revoked',
    resource: 'signing_key',
    details: { keyId, tenantId },
  });

  res.json({ success: true, keyId });
}));

// POST /api/v1/developers/signing-keys/:keyId/rotate
// Creates a new key and revokes the old one. Both are active briefly during rotation.
signingKeysRouter.post('/:keyId/rotate', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const { keyId: oldKeyId } = req.params;
  const { description, overlapMs = 5 * 60 * 1000 } = req.body as { description?: string; overlapMs?: number };

  const existing = await prisma.signingKey.findUnique({ where: { keyId: oldKeyId } });
  if (!existing || existing.tenantId !== tenantId) {
    throw new AppError(404, 'Signing key not found', 'KEY_NOT_FOUND');
  }

  const newKeyId = generateKeyId();
  const rawSecret = randomBytes(32).toString('hex');
  // Old key expires after overlapMs to allow in-flight requests to complete
  const oldExpiresAt = new Date(Date.now() + overlapMs);

  await prisma.$transaction([
    prisma.signingKey.create({
      data: {
        tenantId,
        keyId: newKeyId,
        secretHash: hashSecret(rawSecret),
        description: description ?? existing.description ?? undefined,
      },
    }),
    prisma.signingKey.update({
      where: { keyId: oldKeyId },
      data: { expiresAt: oldExpiresAt },
    }),
  ]);

  invalidateKeyCache(oldKeyId);

  void auditService.logAction({
    action: 'signing_key.rotated',
    resource: 'signing_key',
    details: { oldKeyId, newKeyId, tenantId, overlapMs },
  });

  res.json({ keyId: newKeyId, secret: rawSecret, oldKeyId, oldKeyExpiresAt: oldExpiresAt });
}));
