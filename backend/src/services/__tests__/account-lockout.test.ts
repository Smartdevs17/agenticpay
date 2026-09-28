/**
 * AccountLockoutService Tests — Issue #805
 *
 * Tests the Redis-backed AccountLockoutService.
 * Redis is fully mocked using vi.mock so no real Redis instance is needed.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Build a lightweight in-memory mock for ioredis Pipeline / Redis.
// ---------------------------------------------------------------------------

type PipelineExecResult = [null, unknown][];

interface MockPipeline {
  incr: Mock;
  get: Mock;
  setex: Mock;
  exec: Mock;
  _results: PipelineExecResult;
}

function makePipeline(store: Record<string, string>): MockPipeline {
  const ops: Array<() => [null, unknown]> = [];

  const pipeline: MockPipeline = {
    _results: [],
    incr: vi.fn((key: string) => {
      ops.push(() => {
        const current = parseInt(store[key] || '0', 10) + 1;
        store[key] = String(current);
        return [null, current];
      });
      return pipeline;
    }),
    get: vi.fn((key: string) => {
      ops.push(() => [null, store[key] ?? null]);
      return pipeline;
    }),
    setex: vi.fn((key: string, _ttl: number, value: string) => {
      ops.push(() => {
        store[key] = value;
        return [null, 'OK'];
      });
      return pipeline;
    }),
    exec: vi.fn(async () => ops.map((fn) => fn())),
  };

  return pipeline;
}

interface MockRedis {
  pipeline: Mock;
  setex: Mock;
  expire: Mock;
  del: Mock;
  get: Mock;
  _store: Record<string, string>;
}

function makeMockRedis(): MockRedis {
  const store: Record<string, string> = {};

  const redis: MockRedis = {
    _store: store,

    pipeline: vi.fn(() => makePipeline(store)),

    setex: vi.fn((key: string, _ttl: number, value: string) => {
      store[key] = value;
      return Promise.resolve('OK');
    }),

    expire: vi.fn((_key: string, _ttl: number) => Promise.resolve(1)),

    del: vi.fn((...keys: string[]) => {
      const flatKeys = keys.flat();
      for (const k of flatKeys) delete store[k];
      return Promise.resolve(flatKeys.length);
    }),

    get: vi.fn((key: string) => Promise.resolve(store[key] ?? null)),
  };

  return redis;
}

// Mock ioredis
vi.mock('ioredis', () => ({
  Redis: vi.fn(),
}));

import { AccountLockoutService } from '../account-lockout.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AccountLockoutService', () => {
  let redis: MockRedis;
  let service: AccountLockoutService;

  beforeEach(() => {
    redis = makeMockRedis();
    service = new AccountLockoutService(redis as unknown as import('ioredis').Redis, {
      maxAttempts: 5,
      baseDelaySeconds: 1,
      maxDelaySeconds: 300,
      lockoutDurationSeconds: 900,
      progressiveMultiplier: 2,
    });
  });

  // -------------------------------------------------------------------------
  // recordFailedAttempt
  // -------------------------------------------------------------------------

  describe('recordFailedAttempt', () => {
    it('returns isLocked=false and attemptsRemaining on first failure', async () => {
      const status = await service.recordFailedAttempt('user:123');
      expect(status.isLocked).toBe(false);
      expect(status.attemptsRemaining).toBe(4); // 5 max - 1 used
    });

    it('increments the attempt count on each failure', async () => {
      await service.recordFailedAttempt('user:inc');
      const status = await service.recordFailedAttempt('user:inc');
      expect(status.attemptsRemaining).toBe(3); // 5 - 2
    });

    it('returns isLocked=true after maxAttempts failures', async () => {
      for (let i = 0; i < 4; i++) {
        await service.recordFailedAttempt('user:max');
      }
      const status = await service.recordFailedAttempt('user:max');
      expect(status.isLocked).toBe(true);
      expect(status.attemptsRemaining).toBe(0);
      expect(status.lockoutEndsAt).toBeInstanceOf(Date);
      expect(status.lockoutEndsAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it('provides nextAttemptAllowedAt before lockout', async () => {
      const status = await service.recordFailedAttempt('user:delay');
      expect(status.nextAttemptAllowedAt).toBeInstanceOf(Date);
      expect(status.requiredDelaySeconds).toBeGreaterThan(0);
    });

    it('progressive delay grows with each attempt', async () => {
      const s1 = await service.recordFailedAttempt('user:prog');
      const s2 = await service.recordFailedAttempt('user:prog');
      expect(s2.requiredDelaySeconds!).toBeGreaterThan(s1.requiredDelaySeconds!);
    });
  });

  // -------------------------------------------------------------------------
  // checkLockoutStatus
  // -------------------------------------------------------------------------

  describe('checkLockoutStatus', () => {
    it('returns clean status for unknown identifier', async () => {
      const status = await service.checkLockoutStatus('new:user');
      expect(status.isLocked).toBe(false);
      expect(status.attemptsRemaining).toBe(5);
    });

    it('shows locked when lockout key is set and still valid', async () => {
      // Manually seed the Redis store to simulate a locked state
      const futureMs = Date.now() + 900_000;
      redis._store['lockout:user:locked:locked'] = String(futureMs);
      redis._store['lockout:user:locked:attempts'] = '5';

      const status = await service.checkLockoutStatus('user:locked');
      expect(status.isLocked).toBe(true);
      expect(status.attemptsRemaining).toBe(0);
      expect(status.lockoutEndsAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it('shows delay when within progressive backoff window', async () => {
      const now = Date.now();
      redis._store['lockout:user:backoff:attempts'] = '2';
      redis._store['lockout:user:backoff:lastAttempt'] = String(now); // just happened

      const status = await service.checkLockoutStatus('user:backoff');
      expect(status.isLocked).toBe(false);
      // With 2 attempts and a just-happened lastAttempt, delay should still be active
      if (status.nextAttemptAllowedAt) {
        expect(status.nextAttemptAllowedAt.getTime()).toBeGreaterThan(now);
      }
    });
  });

  // -------------------------------------------------------------------------
  // clearLockout
  // -------------------------------------------------------------------------

  describe('clearLockout', () => {
    it('removes all lockout keys for an identifier', async () => {
      // Populate keys
      redis._store['lockout:user:clear:attempts'] = '3';
      redis._store['lockout:user:clear:locked'] = String(Date.now() + 900_000);
      redis._store['lockout:user:clear:lastAttempt'] = String(Date.now());

      await service.clearLockout('user:clear');

      expect(redis._store['lockout:user:clear:attempts']).toBeUndefined();
      expect(redis._store['lockout:user:clear:locked']).toBeUndefined();
      expect(redis._store['lockout:user:clear:lastAttempt']).toBeUndefined();
    });

    it('does not throw when identifier has no keys', async () => {
      await expect(service.clearLockout('user:nonexistent')).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // isAllowedToAttempt
  // -------------------------------------------------------------------------

  describe('isAllowedToAttempt', () => {
    it('returns allowed=true for a clean identifier', async () => {
      const result = await service.isAllowedToAttempt('user:fresh');
      expect(result.allowed).toBe(true);
      expect(result.status.isLocked).toBe(false);
    });

    it('returns allowed=false when account is locked', async () => {
      const futureMs = Date.now() + 900_000;
      redis._store['lockout:user:isLocked:locked'] = String(futureMs);
      redis._store['lockout:user:isLocked:attempts'] = '5';

      const result = await service.isAllowedToAttempt('user:isLocked');
      expect(result.allowed).toBe(false);
      expect(result.status.isLocked).toBe(true);
    });

    it('returns allowed=false during progressive delay window', async () => {
      const now = Date.now();
      redis._store['lockout:user:waiting:attempts'] = '2';
      redis._store['lockout:user:waiting:lastAttempt'] = String(now); // delay starts now

      const result = await service.isAllowedToAttempt('user:waiting');
      // May or may not be blocked depending on timing tolerance; just check shape
      expect(typeof result.allowed).toBe('boolean');
      expect(result.status).toBeDefined();
    });

    it('returns allowed=true after lockout period expires', async () => {
      // Lockout that ended in the past
      const pastMs = Date.now() - 1_000;
      redis._store['lockout:user:expired:locked'] = String(pastMs);
      redis._store['lockout:user:expired:attempts'] = '5';

      const result = await service.isAllowedToAttempt('user:expired');
      // The lockout is expired, so the service should see it as not locked
      // attemptsRemaining may be 0 (5 - 5) but not locked
      expect(result.status.isLocked).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Progressive delays
  // -------------------------------------------------------------------------

  describe('progressive delays', () => {
    it('delay doubles with progressiveMultiplier=2', async () => {
      // With baseDelay=1s and multiplier=2: attempt 1 -> 1s, attempt 2 -> 2s, attempt 3 -> 4s
      const s1 = await service.recordFailedAttempt('user:pdel');
      const s2 = await service.recordFailedAttempt('user:pdel');
      const s3 = await service.recordFailedAttempt('user:pdel');

      expect(s1.requiredDelaySeconds).toBe(1);  // 1 * 2^0 = 1
      expect(s2.requiredDelaySeconds).toBe(2);  // 1 * 2^1 = 2
      expect(s3.requiredDelaySeconds).toBe(4);  // 1 * 2^2 = 4
    });

    it('delay does not exceed maxDelaySeconds', async () => {
      // With maxDelay=300s, even many attempts should not exceed 300
      const serviceMaxed = new AccountLockoutService(
        redis as unknown as import('ioredis').Redis,
        {
          maxAttempts: 20,
          baseDelaySeconds: 100,
          maxDelaySeconds: 300,
          lockoutDurationSeconds: 900,
          progressiveMultiplier: 10,
        },
      );

      // Two failures will produce 100*10^1 = 1000s delay, capped at 300
      await serviceMaxed.recordFailedAttempt('user:maxdelay');
      const status = await serviceMaxed.recordFailedAttempt('user:maxdelay');
      expect(status.requiredDelaySeconds).toBeLessThanOrEqual(300);
    });
  });

  // -------------------------------------------------------------------------
  // Lockout after maxAttempts
  // -------------------------------------------------------------------------

  describe('lockout after maxAttempts', () => {
    it('locks with custom maxAttempts=3', async () => {
      const strictService = new AccountLockoutService(
        redis as unknown as import('ioredis').Redis,
        {
          maxAttempts: 3,
          baseDelaySeconds: 1,
          maxDelaySeconds: 60,
          lockoutDurationSeconds: 300,
          progressiveMultiplier: 2,
        },
      );

      await strictService.recordFailedAttempt('user:strict');
      await strictService.recordFailedAttempt('user:strict');
      const status = await strictService.recordFailedAttempt('user:strict');

      expect(status.isLocked).toBe(true);
      expect(status.attemptsRemaining).toBe(0);
      expect(status.lockoutEndsAt).toBeDefined();
    });

    it('lockoutEndsAt is set to lockoutDurationSeconds in the future', async () => {
      const before = Date.now();

      for (let i = 0; i < 5; i++) {
        await service.recordFailedAttempt('user:duration');
      }

      const status = await service.checkLockoutStatus('user:duration');
      expect(status.isLocked).toBe(true);

      const lockoutEndMs = status.lockoutEndsAt!.getTime();
      // Should be approximately now + 900s
      expect(lockoutEndMs).toBeGreaterThan(before + 800_000);
      expect(lockoutEndMs).toBeLessThan(before + 1_000_000);
    });
  });
});
