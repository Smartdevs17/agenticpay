// Token rotation service — Issue #512
// Implements NIST SP 800-63B-compliant refresh token rotation:
// - Opaque 32-byte refresh tokens, only SHA-256 hashes stored in DB
// - Token family tracking; reuse of a rotated token revokes the entire family
// - Absolute TTL (configurable, default 30 days) + sliding expiration (default 7 days)
// - Redis blacklist for immediate family revocation

import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { auditService } from '../services/auditService.js';
import { getSharedRateLimitRedis } from '../config/rate-limit-redis.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface TokenRotationConfig {
  absoluteTtlMs: number;
  slidingTtlMs: number;
}

const DEFAULT_CONFIG: TokenRotationConfig = {
  absoluteTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  slidingTtlMs:   7 * 24 * 60 * 60 * 1000, // 7 days inactivity
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateRawToken(): string {
  return randomBytes(32).toString('hex');
}

const FAMILY_BLACKLIST_PREFIX = 'rt:revoked-family:';

async function isRevokedFamily(familyId: string): Promise<boolean> {
  try {
    const redis = await getSharedRateLimitRedis();
    if (redis) {
      const val = await redis.get(`${FAMILY_BLACKLIST_PREFIX}${familyId}`);
      return val !== null;
    }
  } catch { /* fall through to DB check */ }
  // DB fallback: check if any token in family is revoked with reason 'family_revoked'
  const count = await prisma.refreshToken.count({
    where: { familyId, revokeReason: 'family_revoked', revoked: true },
  });
  return count > 0;
}

async function revokeFamily(familyId: string, reason: string): Promise<void> {
  const absoluteTtlSec = Math.ceil(DEFAULT_CONFIG.absoluteTtlMs / 1000);
  try {
    const redis = await getSharedRateLimitRedis();
    if (redis) {
      await redis.set(
        `${FAMILY_BLACKLIST_PREFIX}${familyId}`,
        reason,
        'EX',
        absoluteTtlSec,
      );
    }
  } catch { /* continue to DB update */ }

  await prisma.refreshToken.updateMany({
    where: { familyId, revoked: false },
    data: { revoked: true, revokedAt: new Date(), revokeReason: 'family_revoked' },
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/** Issue the first token pair when a user authenticates. */
export async function issueTokenFamily(
  userId: string,
  tenantId: string,
  config: TokenRotationConfig = DEFAULT_CONFIG,
): Promise<IssuedTokens> {
  const familyId = randomBytes(16).toString('hex');
  const rawRefresh = generateRawToken();
  const now = new Date();
  const absoluteExpiresAt = new Date(now.getTime() + config.absoluteTtlMs);
  const slidingExpiresAt = new Date(now.getTime() + config.slidingTtlMs);

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(rawRefresh),
      familyId,
      userId,
      tenantId,
      absoluteExpiresAt,
      slidingExpiresAt,
      lastUsedAt: now,
    },
  });

  void auditService.logAction({
    userId,
    action: 'token.family_issued',
    resource: 'refresh_token',
    details: { familyId, tenantId },
  });

  return {
    accessToken: `at_${randomBytes(32).toString('hex')}`,
    refreshToken: rawRefresh,
    refreshTokenExpiresAt: slidingExpiresAt,
  };
}

export interface RotateResult {
  ok: true;
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface RotateError {
  ok: false;
  reason: 'not_found' | 'revoked' | 'expired' | 'family_compromised';
}

/** Rotate a refresh token. Issues a new pair and invalidates the old token. */
export async function rotateRefreshToken(
  rawToken: string,
  config: TokenRotationConfig = DEFAULT_CONFIG,
): Promise<RotateResult | RotateError> {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!existing) {
    return { ok: false, reason: 'not_found' };
  }

  if (existing.revoked) {
    // A rotated token was reused — this signals token theft. Revoke entire family.
    await revokeFamily(existing.familyId, 'replay_detected');
    void auditService.logAction({
      userId: existing.userId,
      action: 'token.family_revoked',
      resource: 'refresh_token',
      details: { familyId: existing.familyId, reason: 'replay_detected', tenantId: existing.tenantId },
    });
    return { ok: false, reason: 'family_compromised' };
  }

  // Check Redis blacklist first (fast path)
  if (await isRevokedFamily(existing.familyId)) {
    return { ok: false, reason: 'family_compromised' };
  }

  if (now > existing.absoluteExpiresAt || now > existing.slidingExpiresAt) {
    await prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revoked: true, revokedAt: now, revokeReason: 'expired' },
    });
    return { ok: false, reason: 'expired' };
  }

  // Issue new token in same family
  const rawNew = generateRawToken();
  const slidingExpiresAt = new Date(now.getTime() + config.slidingTtlMs);

  const [newToken] = await prisma.$transaction([
    prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(rawNew),
        familyId: existing.familyId,
        userId: existing.userId,
        tenantId: existing.tenantId,
        absoluteExpiresAt: existing.absoluteExpiresAt,
        slidingExpiresAt,
        lastUsedAt: now,
      },
    }),
    prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revoked: true, revokedAt: now, revokeReason: 'rotated' },
    }),
  ]);

  void auditService.logAction({
    userId: existing.userId,
    action: 'token.rotated',
    resource: 'refresh_token',
    details: { familyId: existing.familyId, newTokenId: newToken.id, tenantId: existing.tenantId },
  });

  return {
    ok: true,
    accessToken: `at_${randomBytes(32).toString('hex')}`,
    refreshToken: rawNew,
    refreshTokenExpiresAt: slidingExpiresAt,
  };
}

/** Revoke a specific token by its raw value. */
export async function revokeToken(rawToken: string, userId?: string): Promise<boolean> {
  const tokenHash = hashToken(rawToken);
  const token = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!token || token.revoked) return false;

  await prisma.refreshToken.update({
    where: { tokenHash },
    data: { revoked: true, revokedAt: new Date(), revokeReason: 'manual_revocation' },
  });

  void auditService.logAction({
    userId: userId ?? token.userId,
    action: 'token.revoked',
    resource: 'refresh_token',
    details: { familyId: token.familyId, tenantId: token.tenantId },
  });

  return true;
}

/** Revoke all token families for a user (e.g., "sign out everywhere"). */
export async function revokeAllUserTokens(userId: string, tenantId: string): Promise<number> {
  // Get unique families to blacklist in Redis
  const families = await prisma.refreshToken.findMany({
    where: { userId, tenantId, revoked: false },
    select: { familyId: true },
    distinct: ['familyId'],
  });

  for (const { familyId } of families) {
    await revokeFamily(familyId, 'sign_out_all');
  }

  const result = await prisma.refreshToken.updateMany({
    where: { userId, tenantId, revoked: false },
    data: { revoked: true, revokedAt: new Date(), revokeReason: 'sign_out_all' },
  });

  void auditService.logAction({
    userId,
    action: 'token.revoke_all',
    resource: 'refresh_token',
    details: { tenantId, count: result.count },
  });

  return result.count;
}

/** List active token families for a user (for session management UI). */
export async function listUserTokenFamilies(userId: string, tenantId: string) {
  const tokens = await prisma.refreshToken.findMany({
    where: { userId, tenantId, revoked: false },
    select: {
      familyId: true,
      createdAt: true,
      lastUsedAt: true,
      absoluteExpiresAt: true,
      slidingExpiresAt: true,
    },
    orderBy: { lastUsedAt: 'desc' },
  });

  // Deduplicate by familyId (take most recent per family)
  const seen = new Set<string>();
  return tokens.filter(t => {
    if (seen.has(t.familyId)) return false;
    seen.add(t.familyId);
    return true;
  });
}

/** Prune expired tokens from the DB (run periodically). */
export async function pruneExpiredTokens(): Promise<number> {
  const now = new Date();
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { absoluteExpiresAt: { lt: now } },
        { slidingExpiresAt: { lt: now } },
      ],
    },
  });
  return result.count;
}
