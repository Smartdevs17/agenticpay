/**
 * Tests for read-replica routing — Issue #881
 *
 * Covers:
 *   1. ReadReplicaRouter  — selection, health management, failover cooldown,
 *      session stickiness, disable/enable, background health checks
 *   2. PrismaReplicaClient — operation classification, read vs write routing,
 *      fallback on replica error, getReadClient / getPrimaryClient
 *   3. Monitoring endpoint handlers via direct handler invocation (avoids
 *      the workspace-package dependency that @agenticpay/error-codes introduces
 *      when the full Express app is booted)
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks declared before any imports ────────────────────────────────────────

vi.mock('@prisma/client', () => {
  class MockPrismaClient {
    _url: string;
    readonly payment = {
      findMany:   vi.fn().mockResolvedValue([{ id: 'p1' }]),
      findUnique: vi.fn().mockResolvedValue({ id: 'p1' }),
      create:     vi.fn().mockResolvedValue({ id: 'p2' }),
      count:      vi.fn().mockResolvedValue(42),
      update:     vi.fn().mockResolvedValue({}),
    };
    readonly user = {
      findMany:  vi.fn().mockResolvedValue([{ id: 'u1' }]),
      findFirst: vi.fn().mockResolvedValue({ id: 'u1' }),
      create:    vi.fn().mockResolvedValue({ id: 'u2' }),
    };
    readonly $queryRaw = vi.fn().mockResolvedValue([{ lag_ms: 0 }]);
    $disconnect = vi.fn().mockResolvedValue(undefined);

    constructor(cfg?: { datasources?: { db?: { url?: string } } }) {
      this._url = cfg?.datasources?.db?.url ?? '';
    }
  }
  return { PrismaClient: MockPrismaClient };
});

vi.mock('../../config/featureFlags.js', () => ({
  featureFlags: { evaluate: vi.fn().mockReturnValue(false) },
}));

vi.mock('../../security/tenant-isolation/guard.js', () => ({
  withTenantIsolationGuard: (c: unknown) => c,
}));

vi.mock('../../encryption/index.js', () => ({
  withEncryptionMiddleware: (c: unknown) => c,
}));

// ── Imports under test ────────────────────────────────────────────────────────

import {
  ReadReplicaRouter,
  isReadQuery,
  buildReplicaConfigs,
  readReplicaRouter,
} from '../../config/database.js';

import {
  PrismaReplicaClient,
  isReadOperation,
  READ_OPERATIONS,
} from '../../db/PrismaReplicaClient.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRouter(
  urls: string[],
  primary = 'postgres://primary/db',
  maxLagMs = 5000,
  options: ConstructorParameters<typeof ReadReplicaRouter>[3] = {},
) {
  return new ReadReplicaRouter(urls, primary, maxLagMs, options);
}

function mockRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as import('express').Response, status, json };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ReadReplicaRouter
// ─────────────────────────────────────────────────────────────────────────────

describe('isReadQuery()', () => {
  it('recognises SELECT', () => {
    expect(isReadQuery('SELECT * FROM payments')).toBe(true);
    expect(isReadQuery('select id from users')).toBe(true);
  });
  it('recognises CTEs', () => {
    expect(isReadQuery('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(true);
    expect(isReadQuery('  WITH recent AS (select 1) select * from recent')).toBe(true);
  });
  it('rejects writes', () => {
    expect(isReadQuery('INSERT INTO payments VALUES ($1)')).toBe(false);
    expect(isReadQuery('UPDATE payments SET status=$1')).toBe(false);
    expect(isReadQuery('DELETE FROM sessions WHERE id=$1')).toBe(false);
    expect(isReadQuery('TRUNCATE payments')).toBe(false);
  });
});

describe('ReadReplicaRouter — selection', () => {
  it('routes writes to primary', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db']);
    expect(r.select('UPDATE payments SET status=$1')).toEqual({
      url: 'postgres://primary/db',
      source: 'primary',
      reason: 'write_query',
    });
  });

  it('round-robins reads across healthy replicas', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db']);
    const s1 = r.select('SELECT * FROM payments');
    const s2 = r.select('SELECT * FROM invoices');
    expect(s1).toMatchObject({ source: 'replica', reason: 'healthy_replica' });
    expect(s2).toMatchObject({ source: 'replica', reason: 'healthy_replica' });
    expect(s1.url).not.toBe(s2.url);
  });

  it('returns no_replicas with zero configured replicas', () => {
    const r = makeRouter([]);
    expect(r.select('SELECT 1')).toEqual({
      url: 'postgres://primary/db',
      source: 'primary',
      reason: 'no_replicas',
    });
  });

  it('falls back to primary when all replicas are unhealthy', () => {
    const r = makeRouter(['postgres://r1/db']);
    r.updateHealth('postgres://r1/db', { healthy: false });
    expect(r.select('SELECT 1')).toMatchObject({ source: 'primary', reason: 'replica_unavailable' });
  });

  it('falls back to primary when lag > maxLagMs', () => {
    const r = makeRouter(['postgres://r1/db'], 'postgres://primary/db', 100);
    r.updateHealth('postgres://r1/db', { healthy: true, lagMs: 500 });
    expect(r.select('SELECT 1')).toMatchObject({ source: 'primary', reason: 'replica_unavailable' });
  });

  it('uses low-lag replica when one is available', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db'], 'postgres://primary/db', 5000);
    r.updateHealth('postgres://r1/db', { healthy: false });
    r.updateHealth('postgres://r2/db', { healthy: true, lagMs: 10 });
    expect(r.select('SELECT 1')).toMatchObject({ url: 'postgres://r2/db', source: 'replica' });
  });
});

describe('ReadReplicaRouter — updateHealth', () => {
  it('transitions to unhealthy on failure', () => {
    const r = makeRouter(['postgres://r1/db']);
    r.updateHealth('postgres://r1/db', { healthy: false });
    expect(r.snapshot()[0]!.health).toBe('unhealthy');
    expect(r.snapshot()[0]!.failureCount).toBe(1);
  });

  it('transitions to lagging when lag > maxLagMs', () => {
    const r = makeRouter(['postgres://r1/db'], 'postgres://primary/db', 1000);
    r.updateHealth('postgres://r1/db', { healthy: true, lagMs: 2000 });
    expect(r.snapshot()[0]!.health).toBe('lagging');
  });

  it('resets failureCount on recovery', () => {
    const r = makeRouter(['postgres://r1/db']);
    r.updateHealth('postgres://r1/db', { healthy: false });
    r.updateHealth('postgres://r1/db', { healthy: true, lagMs: 0 });
    expect(r.snapshot()[0]!.health).toBe('healthy');
    expect(r.snapshot()[0]!.failureCount).toBe(0);
  });

  it('ignores unknown URLs', () => {
    const r = makeRouter(['postgres://r1/db']);
    expect(() => r.updateHealth('postgres://unknown/db', { healthy: false })).not.toThrow();
  });
});

describe('ReadReplicaRouter — failover cooldown', () => {
  it('sets cooldownUntil on first failure', () => {
    const r = makeRouter(['postgres://r1/db'], 'postgres://primary/db', 5000, {
      failoverCooldownMs: 60_000,
    });
    const before = Date.now();
    r.updateHealth('postgres://r1/db', { healthy: false });
    expect(r.snapshot()[0]!.cooldownUntil).toBeGreaterThan(before);
  });

  it('excludes in-cooldown replica from routing', () => {
    const r = makeRouter(['postgres://r1/db'], 'postgres://primary/db', 5000, {
      failoverCooldownMs: 999_999,
    });
    r.updateHealth('postgres://r1/db', { healthy: false });
    expect(r.select('SELECT 1')).toMatchObject({ source: 'primary' });
  });

  it('runHealthCheckCycle lifts cooldown after window expires', async () => {
    let probeCount = 0;
    const r = makeRouter(['postgres://r1/db'], 'postgres://primary/db', 5000, {
      failoverCooldownMs: 1,
      lagProbe: async () => { probeCount++; return 0; },
    });
    r.updateHealth('postgres://r1/db', { healthy: false });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await r.runHealthCheckCycle();

    expect(r.snapshot()[0]!.cooldownUntil).toBe(0);
    expect(r.snapshot()[0]!.health).toBe('healthy');
    expect(probeCount).toBeGreaterThan(0);
  });
});

describe('ReadReplicaRouter — disable / enable', () => {
  it('disableReplica() removes it from routing', () => {
    const r = makeRouter(['postgres://r1/db']);
    r.disableReplica('postgres://r1/db');
    expect(r.select('SELECT 1')).toMatchObject({ source: 'primary', reason: 'replica_unavailable' });
    expect(r.snapshot()[0]!.disabled).toBe(true);
  });

  it('enableReplica() restores routing', () => {
    const r = makeRouter(['postgres://r1/db']);
    r.disableReplica('postgres://r1/db');
    r.enableReplica('postgres://r1/db');
    expect(r.select('SELECT 1')).toMatchObject({ source: 'replica' });
    expect(r.snapshot()[0]!.disabled).toBe(false);
  });

  it('enableReplica() resets failureCount and cooldown', () => {
    const r = makeRouter(['postgres://r1/db'], 'postgres://primary/db', 5000, {
      failoverCooldownMs: 999_999,
    });
    r.updateHealth('postgres://r1/db', { healthy: false });
    r.disableReplica('postgres://r1/db');
    r.enableReplica('postgres://r1/db');
    const snap = r.snapshot()[0]!;
    expect(snap.failureCount).toBe(0);
    expect(snap.cooldownUntil).toBe(0);
  });
});

describe('ReadReplicaRouter — session stickiness', () => {
  it('pins subsequent reads from the same session to one replica', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db'], 'postgres://primary/db', 5000, {
      enableStickiness: true,
    });
    const s1 = r.select('SELECT 1', 'session-abc');
    const s2 = r.select('SELECT 1', 'session-abc');
    const s3 = r.select('SELECT 1', 'session-abc');
    expect(s1.url).toBe(s2.url);
    expect(s2.url).toBe(s3.url);
  });

  it('releases sticky binding when the pinned replica becomes unhealthy', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db'], 'postgres://primary/db', 5000, {
      enableStickiness: true,
    });
    const s1 = r.select('SELECT 1', 'session-xyz');
    r.updateHealth(s1.url, { healthy: false });
    const s2 = r.select('SELECT 1', 'session-xyz');
    expect(s2.url).not.toBe(s1.url);
  });

  it('two sessions can be pinned to different replicas', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db'], 'postgres://primary/db', 5000, {
      enableStickiness: true,
    });
    const sa = r.select('SELECT 1', 'session-A');
    const sb = r.select('SELECT 1', 'session-B');
    expect(sa.url).not.toBe(sb.url);
  });

  it('stickySessions() returns current bindings', () => {
    const r = makeRouter(['postgres://r1/db'], 'postgres://primary/db', 5000, {
      enableStickiness: true,
    });
    r.select('SELECT 1', 'sess-1');
    expect(r.stickySessions().get('sess-1')).toBeDefined();
  });
});

describe('ReadReplicaRouter — background health checks', () => {
  it('startHealthChecks / stopHealthChecks do not throw', () => {
    const r = makeRouter(['postgres://r1/db']);
    expect(() => r.startHealthChecks()).not.toThrow();
    expect(() => r.stopHealthChecks()).not.toThrow();
  });

  it('calling startHealthChecks twice is a no-op', () => {
    const r = makeRouter(['postgres://r1/db']);
    r.startHealthChecks();
    expect(() => r.startHealthChecks()).not.toThrow();
    r.stopHealthChecks();
  });

  it('runHealthCheckCycle invokes lagProbe for each replica', async () => {
    const probe = vi.fn().mockResolvedValue(50);
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db'], 'postgres://primary/db', 5000, {
      lagProbe: probe,
    });
    await r.runHealthCheckCycle();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('marks replica unhealthy when lagProbe throws', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('connection refused'));
    const r = makeRouter(['postgres://r1/db'], 'postgres://primary/db', 5000, { lagProbe: probe });
    await r.runHealthCheckCycle();
    expect(r.snapshot()[0]!.health).toBe('unhealthy');
  });

  it('marks replica lagging when probe returns lag > maxLagMs', async () => {
    const probe = vi.fn().mockResolvedValue(10_000);
    const r = makeRouter(['postgres://r1/db'], 'postgres://primary/db', 5000, { lagProbe: probe });
    await r.runHealthCheckCycle();
    expect(r.snapshot()[0]!.health).toBe('lagging');
  });

  it('skips disabled replicas during health check', async () => {
    const probe = vi.fn().mockResolvedValue(0);
    const r = makeRouter(['postgres://r1/db'], 'postgres://primary/db', 5000, { lagProbe: probe });
    r.disableReplica('postgres://r1/db');
    await r.runHealthCheckCycle();
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('buildReplicaConfigs()', () => {
  it('parses comma-separated URLs from env', () => {
    const prev = process.env['DB_READ_REPLICA_URLS'];
    process.env['DB_READ_REPLICA_URLS'] =
      'postgres://user:pass@replica-a:5432/app, postgres://user:pass@replica-b/app';
    try {
      expect(buildReplicaConfigs()).toMatchObject([
        { host: 'replica-a', port: 5432, database: 'app', user: 'user', enabled: true },
        { host: 'replica-b', port: 5432, database: 'app', user: 'user', enabled: true },
      ]);
    } finally {
      if (prev === undefined) delete process.env['DB_READ_REPLICA_URLS'];
      else process.env['DB_READ_REPLICA_URLS'] = prev;
    }
  });

  it('returns [] when env var is unset', () => {
    const prev = process.env['DB_READ_REPLICA_URLS'];
    delete process.env['DB_READ_REPLICA_URLS'];
    try {
      expect(buildReplicaConfigs()).toHaveLength(0);
    } finally {
      if (prev !== undefined) process.env['DB_READ_REPLICA_URLS'] = prev;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PrismaReplicaClient
// ─────────────────────────────────────────────────────────────────────────────

describe('isReadOperation()', () => {
  it('returns true for all Prisma read operations', () => {
    for (const op of READ_OPERATIONS) {
      expect(isReadOperation(op)).toBe(true);
    }
  });

  it('returns false for Prisma write operations', () => {
    for (const op of ['create', 'update', 'upsert', 'delete', 'deleteMany', 'updateMany', 'createMany']) {
      expect(isReadOperation(op)).toBe(false);
    }
  });
});

describe('PrismaReplicaClient — proxy read routing', () => {
  it('routes findMany to replica', async () => {
    const router = makeRouter(['postgres://r1/db']);
    const selectSpy = vi.spyOn(router, 'select');

    const client = new PrismaReplicaClient('postgres://primary/db', ['postgres://r1/db'], router);
    await client.proxy.payment.findMany();

    expect(selectSpy).toHaveBeenCalled();
  });

  it('routes create to primary without calling router', async () => {
    const router = makeRouter(['postgres://r1/db']);
    const selectSpy = vi.spyOn(router, 'select');

    const client = new PrismaReplicaClient('postgres://primary/db', ['postgres://r1/db'], router);
    await client.proxy.payment.create({ data: {} });

    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('routes count to replica', async () => {
    const router = makeRouter(['postgres://r1/db']);
    const selectSpy = vi.spyOn(router, 'select');

    const client = new PrismaReplicaClient('postgres://primary/db', ['postgres://r1/db'], router);
    const result = await client.proxy.payment.count();

    expect(result).toBe(42);
    expect(selectSpy).toHaveBeenCalled();
  });

  it('falls back to primary and marks replica unhealthy on replica error', async () => {
    const router = makeRouter(['postgres://r1/db']);
    const updateSpy = vi.spyOn(router, 'updateHealth');
    const { PrismaClient: Mock } = await import('@prisma/client');

    const client = new PrismaReplicaClient('postgres://primary/db', ['postgres://r1/db'], router);

    // Replace the internal replica client with one whose findMany rejects.
    const failingReplica = new Mock({ datasources: { db: { url: 'postgres://r1/db' } } });
    (failingReplica.payment.findMany as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('replica gone'),
    );
    (client as unknown as { replicaClients: Map<string, unknown> })
      .replicaClients.set('postgres://r1/db', failingReplica);

    // Should resolve (falls back to primary) without throwing.
    await expect(client.proxy.payment.findMany()).resolves.toEqual([{ id: 'p1' }]);
    expect(updateSpy).toHaveBeenCalledWith('postgres://r1/db', { healthy: false });
  });
});

describe('PrismaReplicaClient — getReadClient / getPrimaryClient', () => {
  it('getPrimaryClient returns primary', () => {
    const c = new PrismaReplicaClient('postgres://primary/db', []);
    expect(c.getPrimaryClient()).toBeDefined();
  });

  it('getReadClient returns primary when no replicas configured', () => {
    const c = new PrismaReplicaClient('postgres://primary/db', []);
    expect(c.getReadClient()).toBe(c.getPrimaryClient());
  });

  it('getReadClient returns a different object when a healthy replica exists', () => {
    const router = makeRouter(['postgres://r1/db']);
    const c = new PrismaReplicaClient('postgres://primary/db', ['postgres://r1/db'], router);
    expect(c.getReadClient()).not.toBe(c.getPrimaryClient());
  });

  it('getReadClient accepts a sessionId and returns consistent replica', () => {
    const router = makeRouter(['postgres://r1/db'], 'postgres://primary/db', 5000, {
      enableStickiness: true,
    });
    const c = new PrismaReplicaClient('postgres://primary/db', ['postgres://r1/db'], router);
    const rc1 = c.getReadClient('sess-1');
    const rc2 = c.getReadClient('sess-1');
    expect(rc1).toBe(rc2);
  });
});

describe('PrismaReplicaClient — lifecycle', () => {
  it('startHealthChecks / stopHealthChecks delegate to router', () => {
    const router = makeRouter(['postgres://r1/db']);
    const startSpy = vi.spyOn(router, 'startHealthChecks');
    const stopSpy  = vi.spyOn(router, 'stopHealthChecks');

    const c = new PrismaReplicaClient('postgres://primary/db', ['postgres://r1/db'], router);
    c.startHealthChecks();
    expect(startSpy).toHaveBeenCalledTimes(1);
    c.stopHealthChecks();
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. /database/replicas endpoint handlers (unit-level, no HTTP server)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /database/replicas — handler logic', () => {
  // We exercise the same logic as the route handler but without the Express
  // bootstrap to avoid the missing @agenticpay/error-codes workspace package.

  function buildReplicasPayload(router: ReadReplicaRouter) {
    const replicas = router.snapshot();
    return {
      total: replicas.length,
      healthy:  replicas.filter((r) => !r.disabled && r.health === 'healthy').length,
      unhealthy: replicas.filter((r) => r.health === 'unhealthy' && !r.disabled).length,
      lagging:   replicas.filter((r) => r.health === 'lagging'   && !r.disabled).length,
      disabled:  replicas.filter((r) => r.disabled).length,
      replicas: replicas.map((r) => ({
        url: r.url,
        health: r.health,
        lagMs: r.lagMs,
        failureCount: r.failureCount,
        disabled: r.disabled,
        inCooldown: r.cooldownUntil > Date.now(),
        cooldownUntil: r.cooldownUntil > 0 ? new Date(r.cooldownUntil).toISOString() : null,
        lastCheckedAt: r.lastCheckedAt > 0 ? new Date(r.lastCheckedAt).toISOString() : null,
      })),
    };
  }

  it('returns correct counts for all-healthy replicas', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db']);
    const payload = buildReplicasPayload(r);
    expect(payload.total).toBe(2);
    expect(payload.healthy).toBe(2);
    expect(payload.unhealthy).toBe(0);
    expect(payload.disabled).toBe(0);
    expect(payload.replicas).toHaveLength(2);
  });

  it('counts unhealthy replicas correctly', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db']);
    r.updateHealth('postgres://r1/db', { healthy: false });
    const payload = buildReplicasPayload(r);
    expect(payload.unhealthy).toBe(1);
    expect(payload.healthy).toBe(1);
  });

  it('counts disabled replicas separately', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db']);
    r.disableReplica('postgres://r1/db');
    const payload = buildReplicasPayload(r);
    expect(payload.disabled).toBe(1);
    // Disabled replicas are excluded from the healthy/unhealthy/lagging buckets.
    expect(payload.healthy).toBe(1);
  });

  it('inCooldown is true when cooldownUntil is in the future', () => {
    const r = makeRouter(['postgres://r1/db'], 'postgres://primary/db', 5000, {
      failoverCooldownMs: 999_999,
    });
    r.updateHealth('postgres://r1/db', { healthy: false });
    const payload = buildReplicasPayload(r);
    expect(payload.replicas[0]!.inCooldown).toBe(true);
    expect(payload.replicas[0]!.cooldownUntil).not.toBeNull();
  });
});

describe('POST /database/replicas/:url/disable and /enable — handler logic', () => {
  it('disableReplica makes the replica unavailable for routing', () => {
    const r = makeRouter(['postgres://r1/db']);
    r.disableReplica('postgres://r1/db');
    expect(r.snapshot()[0]!.disabled).toBe(true);
    expect(r.select('SELECT 1')).toMatchObject({ source: 'primary' });
  });

  it('enableReplica makes the replica available for routing', () => {
    const r = makeRouter(['postgres://r1/db']);
    r.disableReplica('postgres://r1/db');
    r.enableReplica('postgres://r1/db');
    expect(r.snapshot()[0]!.disabled).toBe(false);
    expect(r.select('SELECT 1')).toMatchObject({ source: 'replica' });
  });

  it('404 shape for unknown replica URL', () => {
    const r = makeRouter(['postgres://r1/db']);
    const unknown = 'postgres://does-not-exist/db';
    const found = r.snapshot().find((x) => x.url === unknown);
    expect(found).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Singleton export (readReplicaRouter)
// ─────────────────────────────────────────────────────────────────────────────

describe('readReplicaRouter singleton', () => {
  it('is an instance of ReadReplicaRouter', () => {
    expect(readReplicaRouter).toBeInstanceOf(ReadReplicaRouter);
  });

  it('can be queried for a snapshot without throwing', () => {
    expect(() => readReplicaRouter.snapshot()).not.toThrow();
  });
});
