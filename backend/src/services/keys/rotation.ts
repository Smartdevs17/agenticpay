// Issue #756: API key rotation with grace period and usage tracking
//
// Rotating a key used to revoke the old one immediately, which breaks any
// in-flight client that hasn't picked up the new key yet. Instead, the
// predecessor key is kept active for a configurable grace period so both
// keys work during the handover window; usage against the predecessor is
// still recorded (see api-usage-tracker.ts / ApiKeyUsage) so the grace
// period's traffic is visible before the old key is retired.

import { prisma } from '../../lib/prisma.js';

const DEFAULT_GRACE_PERIOD_HOURS = 24;
const MAX_GRACE_PERIOD_HOURS = 24 * 30; // 30 days

export function resolveGracePeriodHours(requested?: number): number {
  const envDefault = Number(process.env.API_KEY_ROTATION_GRACE_PERIOD_HOURS);
  const fallback = Number.isFinite(envDefault) && envDefault > 0 ? envDefault : DEFAULT_GRACE_PERIOD_HOURS;

  if (requested === undefined || requested === null) return fallback;
  if (!Number.isFinite(requested) || requested < 0) return fallback;
  return Math.min(requested, MAX_GRACE_PERIOD_HOURS);
}

/**
 * Deactivate this key's grace period if it has expired. Lazy expiry avoids
 * needing a scheduler: any read path that touches the key settles its state.
 */
export async function settleGracePeriod<T extends {
  keyId: string;
  isActive: boolean;
  gracePeriodEndsAt: Date | null;
  revokedAt: Date | null;
}>(key: T): Promise<T> {
  if (!key.isActive || !key.gracePeriodEndsAt || key.gracePeriodEndsAt.getTime() > Date.now()) {
    return key;
  }

  const updated = await prisma.apiKey.update({
    where: { keyId: key.keyId },
    data: { isActive: false, revokedAt: key.revokedAt ?? new Date() },
  });

  return { ...key, isActive: updated.isActive, revokedAt: updated.revokedAt } as T;
}

/**
 * Rotate an API key: the predecessor stays active (still authenticates
 * requests) until `gracePeriodEndsAt`, while a new key is issued to replace
 * it. Both keys' usage is tracked independently via ApiKeyUsage.
 */
export async function rotateApiKeyWithGracePeriod(opts: {
  tenantId: string;
  keyId: string;
  gracePeriodHours?: number;
}) {
  const gracePeriodHours = resolveGracePeriodHours(opts.gracePeriodHours);
  const now = new Date();
  const gracePeriodEndsAt = new Date(now.getTime() + gracePeriodHours * 60 * 60 * 1000);

  const newKeyId = `ak_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const [previousKey, newKey] = await prisma.$transaction(async (tx) => {
    const existing = await tx.apiKey.findUnique({ where: { keyId: opts.keyId } });
    if (!existing || existing.tenantId !== opts.tenantId) {
      throw new Error('API key not found');
    }

    const created = await tx.apiKey.create({
      data: {
        tenantId: opts.tenantId,
        keyId: newKeyId,
        description: existing.description ? `${existing.description} (rotated)` : 'Rotated key',
        expiresAt: existing.expiresAt,
        predecessorKeyId: existing.keyId,
      },
    });

    const previous = await tx.apiKey.update({
      where: { keyId: existing.keyId },
      data: {
        rotatedAt: now,
        gracePeriodEndsAt,
        successorKeyId: created.keyId,
        // isActive stays true — the predecessor remains usable through the grace window.
      },
    });

    return [previous, created];
  });

  return { previousKey, newKey, gracePeriodEndsAt };
}
