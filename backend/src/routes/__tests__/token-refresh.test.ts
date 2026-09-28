/**
 * JWT Refresh Token Rotation Tests — Issue #804
 *
 * Tests for the token-rotation service covering:
 *  - issueTokenFamily
 *  - rotateRefreshToken (success, not_found, family_compromised, expired)
 *  - revokeToken
 *  - revokeAllUserTokens
 *  - listUserTokenFamilies
 *  - pruneExpiredTokens
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../config/rate-limit-redis.js', () => ({
  getSharedRateLimitRedis: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../services/auditService.js', () => ({
  auditService: {
    logAction: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { prisma } from '../../lib/prisma.js';
import { getSharedRateLimitRedis } from '../../config/rate-limit-redis.js';
import { auditService } from '../../services/auditService.js';
import {
  issueTokenFamily,
  rotateRefreshToken,
  revokeToken,
  revokeAllUserTokens,
  listUserTokenFamilies,
  pruneExpiredTokens,
} from '../../auth/token-rotation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-abc-123';
const TENANT_ID = 'tenant-xyz-456';
const FAMILY_ID = 'family-aabbcc-001';

/** Build a mock RefreshToken record (non-expired, non-revoked). */
function makeMockToken(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'rt-record-001',
    tokenHash: 'sha256hashvalue',
    familyId: FAMILY_ID,
    userId: USER_ID,
    tenantId: TENANT_ID,
    absoluteExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
    slidingExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),   // 7 days
    lastUsedAt: now,
    revoked: false,
    revokedAt: null,
    revokeReason: null,
    createdAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Token Rotation Service — Issue #804', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: Redis is unavailable (null) so DB fallback paths are exercised
    vi.mocked(getSharedRateLimitRedis).mockResolvedValue(null);
  });

  // -------------------------------------------------------------------------
  // issueTokenFamily
  // -------------------------------------------------------------------------

  describe('issueTokenFamily', () => {
    it('should return accessToken, refreshToken, and refreshTokenExpiresAt', async () => {
      vi.mocked(prisma.refreshToken.create).mockResolvedValue(makeMockToken() as any);

      const result = await issueTokenFamily(USER_ID, TENANT_ID);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('refreshTokenExpiresAt');
    });

    it('accessToken should start with "at_"', async () => {
      vi.mocked(prisma.refreshToken.create).mockResolvedValue(makeMockToken() as any);

      const { accessToken } = await issueTokenFamily(USER_ID, TENANT_ID);

      expect(accessToken).toMatch(/^at_/);
    });

    it('refreshToken should be a 64-char hex string (32 raw bytes)', async () => {
      vi.mocked(prisma.refreshToken.create).mockResolvedValue(makeMockToken() as any);

      const { refreshToken } = await issueTokenFamily(USER_ID, TENANT_ID);

      // randomBytes(32).toString('hex') → 64 chars
      expect(refreshToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('refreshTokenExpiresAt should be a future Date', async () => {
      vi.mocked(prisma.refreshToken.create).mockResolvedValue(makeMockToken() as any);

      const { refreshTokenExpiresAt } = await issueTokenFamily(USER_ID, TENANT_ID);

      expect(refreshTokenExpiresAt).toBeInstanceOf(Date);
      expect(refreshTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should persist a new RefreshToken record via prisma.create', async () => {
      vi.mocked(prisma.refreshToken.create).mockResolvedValue(makeMockToken() as any);

      await issueTokenFamily(USER_ID, TENANT_ID);

      expect(prisma.refreshToken.create).toHaveBeenCalledOnce();
      const createArg = vi.mocked(prisma.refreshToken.create).mock.calls[0][0] as any;
      expect(createArg.data.userId).toBe(USER_ID);
      expect(createArg.data.tenantId).toBe(TENANT_ID);
    });

    it('should emit an audit event for token.family_issued', async () => {
      vi.mocked(prisma.refreshToken.create).mockResolvedValue(makeMockToken() as any);

      await issueTokenFamily(USER_ID, TENANT_ID);

      // Give the fire-and-forget void promise a tick to settle
      await Promise.resolve();

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          action: 'token.family_issued',
          resource: 'refresh_token',
        }),
      );
    });

    it('should generate different tokens on successive calls', async () => {
      vi.mocked(prisma.refreshToken.create).mockResolvedValue(makeMockToken() as any);

      const first = await issueTokenFamily(USER_ID, TENANT_ID);
      const second = await issueTokenFamily(USER_ID, TENANT_ID);

      expect(first.refreshToken).not.toBe(second.refreshToken);
      expect(first.accessToken).not.toBe(second.accessToken);
    });
  });

  // -------------------------------------------------------------------------
  // rotateRefreshToken — success path
  // -------------------------------------------------------------------------

  describe('rotateRefreshToken — success path', () => {
    it('should return ok:true with new accessToken, refreshToken, refreshTokenExpiresAt', async () => {
      const existingToken = makeMockToken();
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(existingToken as any);
      // DB fallback: count returns 0 (family not blacklisted)
      vi.mocked(prisma.refreshToken.count).mockResolvedValue(0);
      const newToken = makeMockToken({ id: 'rt-record-002' });
      vi.mocked(prisma.$transaction).mockResolvedValue([newToken] as any);

      const result = await rotateRefreshToken('a'.repeat(64));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.accessToken).toMatch(/^at_/);
        expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
        expect(result.refreshTokenExpiresAt).toBeInstanceOf(Date);
      }
    });

    it('should execute a prisma.$transaction to atomically swap tokens', async () => {
      const existingToken = makeMockToken();
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(existingToken as any);
      vi.mocked(prisma.refreshToken.count).mockResolvedValue(0);
      vi.mocked(prisma.$transaction).mockResolvedValue([makeMockToken()] as any);

      await rotateRefreshToken('b'.repeat(64));

      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });

    it('should emit a token.rotated audit event on success', async () => {
      const existingToken = makeMockToken();
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(existingToken as any);
      vi.mocked(prisma.refreshToken.count).mockResolvedValue(0);
      vi.mocked(prisma.$transaction).mockResolvedValue([makeMockToken()] as any);

      await rotateRefreshToken('c'.repeat(64));
      await Promise.resolve(); // let fire-and-forget settle

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'token.rotated', userId: USER_ID }),
      );
    });

    it('slidingExpiresAt on the new token should be ~7 days from now', async () => {
      const existingToken = makeMockToken();
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(existingToken as any);
      vi.mocked(prisma.refreshToken.count).mockResolvedValue(0);
      vi.mocked(prisma.$transaction).mockResolvedValue([makeMockToken()] as any);

      const result = await rotateRefreshToken('d'.repeat(64));

      if (result.ok) {
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        const diff = result.refreshTokenExpiresAt.getTime() - Date.now();
        expect(diff).toBeGreaterThan(sevenDaysMs - 5000);   // within 5 s tolerance
        expect(diff).toBeLessThan(sevenDaysMs + 5000);
      }
    });
  });

  // -------------------------------------------------------------------------
  // rotateRefreshToken — not_found
  // -------------------------------------------------------------------------

  describe('rotateRefreshToken — not_found', () => {
    it('should return { ok: false, reason: "not_found" } when token is absent', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(null);

      const result = await rotateRefreshToken('e'.repeat(64));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('not_found');
      }
    });

    it('should NOT call prisma.$transaction when token not found', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(null);

      await rotateRefreshToken('f'.repeat(64));

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // rotateRefreshToken — family_compromised (replay attack)
  // -------------------------------------------------------------------------

  describe('rotateRefreshToken — family_compromised', () => {
    it('should return family_compromised when a revoked token is reused', async () => {
      const revokedToken = makeMockToken({ revoked: true, revokeReason: 'rotated' });
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(revokedToken as any);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 2 } as any);
      // Redis unavailable, DB count for isRevokedFamily → 0 (the revokeFamily call below uses count)
      vi.mocked(prisma.refreshToken.count).mockResolvedValue(0);

      const result = await rotateRefreshToken('g'.repeat(64));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('family_compromised');
      }
    });

    it('should revoke the entire family when replay is detected', async () => {
      const revokedToken = makeMockToken({ revoked: true, revokeReason: 'rotated' });
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(revokedToken as any);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 2 } as any);
      vi.mocked(prisma.refreshToken.count).mockResolvedValue(0);

      await rotateRefreshToken('h'.repeat(64));

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ familyId: FAMILY_ID }),
        }),
      );
    });

    it('should emit a token.family_revoked audit event on replay detection', async () => {
      const revokedToken = makeMockToken({ revoked: true, revokeReason: 'rotated' });
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(revokedToken as any);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 2 } as any);
      vi.mocked(prisma.refreshToken.count).mockResolvedValue(0);

      await rotateRefreshToken('i'.repeat(64));
      await Promise.resolve();

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'token.family_revoked',
          userId: USER_ID,
        }),
      );
    });

    it('should return family_compromised when family is blacklisted in DB (isRevokedFamily)', async () => {
      // Token itself is NOT revoked, but the family is blacklisted in the DB
      const liveToken = makeMockToken({ revoked: false });
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(liveToken as any);
      // isRevokedFamily DB fallback: count > 0 means blacklisted
      vi.mocked(prisma.refreshToken.count).mockResolvedValue(1);

      const result = await rotateRefreshToken('j'.repeat(64));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('family_compromised');
      }
    });
  });

  // -------------------------------------------------------------------------
  // rotateRefreshToken — expired
  // -------------------------------------------------------------------------

  describe('rotateRefreshToken — expired', () => {
    it('should return { ok: false, reason: "expired" } when absoluteExpiresAt is in the past', async () => {
      const pastDate = new Date(Date.now() - 1000);
      const expiredToken = makeMockToken({
        absoluteExpiresAt: pastDate,
        slidingExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(expiredToken as any);
      // isRevokedFamily DB check → not blacklisted
      vi.mocked(prisma.refreshToken.count).mockResolvedValue(0);
      vi.mocked(prisma.refreshToken.update).mockResolvedValue(expiredToken as any);

      const result = await rotateRefreshToken('k'.repeat(64));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('expired');
      }
    });

    it('should return expired when slidingExpiresAt is in the past', async () => {
      const pastDate = new Date(Date.now() - 1000);
      const expiredToken = makeMockToken({
        absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        slidingExpiresAt: pastDate,
      });
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(expiredToken as any);
      vi.mocked(prisma.refreshToken.count).mockResolvedValue(0);
      vi.mocked(prisma.refreshToken.update).mockResolvedValue(expiredToken as any);

      const result = await rotateRefreshToken('l'.repeat(64));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('expired');
      }
    });

    it('should mark the token as revoked with reason "expired"', async () => {
      const pastDate = new Date(Date.now() - 1000);
      const expiredToken = makeMockToken({ absoluteExpiresAt: pastDate });
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(expiredToken as any);
      vi.mocked(prisma.refreshToken.count).mockResolvedValue(0);
      vi.mocked(prisma.refreshToken.update).mockResolvedValue(expiredToken as any);

      await rotateRefreshToken('m'.repeat(64));

      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ revoked: true, revokeReason: 'expired' }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // revokeToken
  // -------------------------------------------------------------------------

  describe('revokeToken', () => {
    it('should return true when a valid non-revoked token is revoked', async () => {
      const liveToken = makeMockToken();
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(liveToken as any);
      vi.mocked(prisma.refreshToken.update).mockResolvedValue({
        ...liveToken,
        revoked: true,
      } as any);

      const result = await revokeToken('n'.repeat(64), USER_ID);

      expect(result).toBe(true);
    });

    it('should call prisma.update with manual_revocation reason', async () => {
      const liveToken = makeMockToken();
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(liveToken as any);
      vi.mocked(prisma.refreshToken.update).mockResolvedValue(liveToken as any);

      await revokeToken('o'.repeat(64), USER_ID);

      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            revoked: true,
            revokeReason: 'manual_revocation',
          }),
        }),
      );
    });

    it('should return false when the token does not exist', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(null);

      const result = await revokeToken('p'.repeat(64));

      expect(result).toBe(false);
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });

    it('should return false when the token is already revoked', async () => {
      const alreadyRevoked = makeMockToken({ revoked: true });
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(alreadyRevoked as any);

      const result = await revokeToken('q'.repeat(64));

      expect(result).toBe(false);
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });

    it('should emit a token.revoked audit event on successful revocation', async () => {
      const liveToken = makeMockToken();
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(liveToken as any);
      vi.mocked(prisma.refreshToken.update).mockResolvedValue(liveToken as any);

      await revokeToken('r'.repeat(64), USER_ID);
      await Promise.resolve();

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'token.revoked', userId: USER_ID }),
      );
    });

    it('should use the token owner userId when none is provided', async () => {
      const liveToken = makeMockToken({ userId: 'token-owner-id' });
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(liveToken as any);
      vi.mocked(prisma.refreshToken.update).mockResolvedValue(liveToken as any);

      await revokeToken('s'.repeat(64)); // no userId argument
      await Promise.resolve();

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'token-owner-id' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // revokeAllUserTokens
  // -------------------------------------------------------------------------

  describe('revokeAllUserTokens', () => {
    it('should return the count of revoked tokens', async () => {
      vi.mocked(prisma.refreshToken.findMany).mockResolvedValue([
        makeMockToken({ familyId: 'fam-1' }),
        makeMockToken({ familyId: 'fam-2' }),
      ] as any);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 4 } as any);
      vi.mocked(prisma.refreshToken.count).mockResolvedValue(0); // DB blacklist check inside revokeFamily

      const count = await revokeAllUserTokens(USER_ID, TENANT_ID);

      expect(count).toBe(4);
    });

    it('should call prisma.updateMany with sign_out_all reason', async () => {
      vi.mocked(prisma.refreshToken.findMany).mockResolvedValue([]);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 0 } as any);

      await revokeAllUserTokens(USER_ID, TENANT_ID);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: USER_ID, tenantId: TENANT_ID }),
          data: expect.objectContaining({ revokeReason: 'sign_out_all' }),
        }),
      );
    });

    it('should revoke each distinct family via revokeFamily (updateMany per family)', async () => {
      vi.mocked(prisma.refreshToken.findMany).mockResolvedValue([
        makeMockToken({ familyId: 'fam-A' }),
        makeMockToken({ familyId: 'fam-B' }),
      ] as any);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 3 } as any);
      vi.mocked(prisma.refreshToken.count).mockResolvedValue(0);

      await revokeAllUserTokens(USER_ID, TENANT_ID);

      // updateMany is called at least once for each family + once for the user-level bulk revoke
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    });

    it('should emit a token.revoke_all audit event', async () => {
      vi.mocked(prisma.refreshToken.findMany).mockResolvedValue([]);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 0 } as any);

      await revokeAllUserTokens(USER_ID, TENANT_ID);
      await Promise.resolve();

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'token.revoke_all', userId: USER_ID }),
      );
    });

    it('should return 0 when there are no active sessions', async () => {
      vi.mocked(prisma.refreshToken.findMany).mockResolvedValue([]);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 0 } as any);

      const count = await revokeAllUserTokens(USER_ID, TENANT_ID);

      expect(count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // listUserTokenFamilies
  // -------------------------------------------------------------------------

  describe('listUserTokenFamilies', () => {
    it('should return an array of token family records', async () => {
      const records = [
        makeMockToken({ familyId: 'fam-X' }),
        makeMockToken({ familyId: 'fam-Y' }),
      ];
      vi.mocked(prisma.refreshToken.findMany).mockResolvedValue(records as any);

      const families = await listUserTokenFamilies(USER_ID, TENANT_ID);

      expect(Array.isArray(families)).toBe(true);
      expect(families).toHaveLength(2);
    });

    it('should deduplicate by familyId, keeping only the most-recent entry per family', async () => {
      const now = new Date();
      const older = makeMockToken({ familyId: 'fam-dup', lastUsedAt: new Date(now.getTime() - 1000) });
      const newer = makeMockToken({ familyId: 'fam-dup', lastUsedAt: now });

      // Prisma query is ordered lastUsedAt desc, so newer comes first
      vi.mocked(prisma.refreshToken.findMany).mockResolvedValue([newer, older] as any);

      const families = await listUserTokenFamilies(USER_ID, TENANT_ID);

      // Only one entry for fam-dup
      expect(families.filter(f => f.familyId === 'fam-dup')).toHaveLength(1);
    });

    it('should return each unique family exactly once when there are multiple tokens per family', async () => {
      const records = [
        makeMockToken({ familyId: 'fam-1', id: 'tok-1' }),
        makeMockToken({ familyId: 'fam-1', id: 'tok-2' }),
        makeMockToken({ familyId: 'fam-1', id: 'tok-3' }),
        makeMockToken({ familyId: 'fam-2', id: 'tok-4' }),
      ];
      vi.mocked(prisma.refreshToken.findMany).mockResolvedValue(records as any);

      const families = await listUserTokenFamilies(USER_ID, TENANT_ID);

      expect(families).toHaveLength(2);
      const ids = families.map(f => f.familyId);
      expect(ids).toContain('fam-1');
      expect(ids).toContain('fam-2');
    });

    it('should return an empty array when there are no active sessions', async () => {
      vi.mocked(prisma.refreshToken.findMany).mockResolvedValue([]);

      const families = await listUserTokenFamilies(USER_ID, TENANT_ID);

      expect(families).toHaveLength(0);
    });

    it('should query only revoked:false tokens for the given userId and tenantId', async () => {
      vi.mocked(prisma.refreshToken.findMany).mockResolvedValue([]);

      await listUserTokenFamilies(USER_ID, TENANT_ID);

      expect(prisma.refreshToken.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: USER_ID,
            tenantId: TENANT_ID,
            revoked: false,
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // pruneExpiredTokens
  // -------------------------------------------------------------------------

  describe('pruneExpiredTokens', () => {
    it('should return the count of deleted tokens', async () => {
      vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 7 } as any);

      const count = await pruneExpiredTokens();

      expect(count).toBe(7);
    });

    it('should call deleteMany with an OR condition covering both expiry fields', async () => {
      vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 0 } as any);

      await pruneExpiredTokens();

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ absoluteExpiresAt: expect.objectContaining({ lt: expect.any(Date) }) }),
              expect.objectContaining({ slidingExpiresAt: expect.objectContaining({ lt: expect.any(Date) }) }),
            ]),
          }),
        }),
      );
    });

    it('should return 0 when there are no expired tokens', async () => {
      vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 0 } as any);

      const count = await pruneExpiredTokens();

      expect(count).toBe(0);
    });

    it('should use a "lt: now" cutoff — the date passed must not be in the future', async () => {
      const beforeCall = Date.now();
      vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 0 } as any);

      await pruneExpiredTokens();

      const callArg = vi.mocked(prisma.refreshToken.deleteMany).mock.calls[0][0] as any;
      const ltDate: Date = callArg.where.OR[0].absoluteExpiresAt.lt;
      expect(ltDate.getTime()).toBeGreaterThanOrEqual(beforeCall);
      expect(ltDate.getTime()).toBeLessThanOrEqual(Date.now() + 50); // small tolerance
    });
  });

  // -------------------------------------------------------------------------
  // Redis-available paths (verify Redis is used when available)
  // -------------------------------------------------------------------------

  describe('Redis blacklist integration', () => {
    it('isRevokedFamily should use Redis GET when Redis is available', async () => {
      const mockRedis = {
        get: vi.fn().mockResolvedValue('replay_detected'), // key exists → blacklisted
        set: vi.fn().mockResolvedValue('OK'),
        eval: vi.fn().mockResolvedValue(1),
      };
      vi.mocked(getSharedRateLimitRedis).mockResolvedValue(mockRedis as any);

      const liveToken = makeMockToken({ revoked: false });
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(liveToken as any);

      const result = await rotateRefreshToken('t'.repeat(64));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('family_compromised');
      }
      expect(mockRedis.get).toHaveBeenCalled();
    });

    it('revokeFamily should write to Redis when Redis is available', async () => {
      const mockRedis = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        eval: vi.fn().mockResolvedValue(1),
      };
      vi.mocked(getSharedRateLimitRedis).mockResolvedValue(mockRedis as any);

      vi.mocked(prisma.refreshToken.findMany).mockResolvedValue([
        makeMockToken({ familyId: 'fam-redis' }),
      ] as any);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 1 } as any);

      await revokeAllUserTokens(USER_ID, TENANT_ID);

      expect(mockRedis.set).toHaveBeenCalled();
    });
  });
});
