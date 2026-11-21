/**
 * backend/src/services/__tests__/analytics-cache.test.ts
 *
 * Comprehensive tests for Issue #1458: Cache analytics rollups with partition-aware invalidation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AnalyticsRollupCache,
  BoundedLRUCache,
} from '../analytics-cache.js';

describe('AnalyticsRollupCache (Issue #1458)', () => {
  let cache: AnalyticsRollupCache;
  const mockNow = new Date('2026-11-21T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);
    cache = new AnalyticsRollupCache({
      enabled: true,
      openTtlSeconds: 60,
      closedTtlSeconds: 86400,
      maxEntries: 5,
      schemaVersion: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records miss on first read and hit on second read with exact value equality', async () => {
    let loaderCallCount = 0;
    const loader = async () => {
      loaderCallCount++;
      return { totalRevenue: 5000, count: 42 };
    };

    const opts = { tenantId: 'tenant_1', metric: 'summary', partitionDate: mockNow };

    // 1st request -> Miss
    const res1 = await cache.getOrCompute(opts, loader, mockNow);
    expect(res1).toEqual({ totalRevenue: 5000, count: 42 });
    expect(loaderCallCount).toBe(1);

    const metricsAfterMiss = cache.getMetrics();
    expect(metricsAfterMiss.misses).toBe(1);
    expect(metricsAfterMiss.hits).toBe(0);

    // 2nd request -> Hit
    const res2 = await cache.getOrCompute(opts, loader, mockNow);
    expect(res2).toEqual({ totalRevenue: 5000, count: 42 });
    expect(loaderCallCount).toBe(1); // Loader was not called again!

    const metricsAfterHit = cache.getMetrics();
    expect(metricsAfterHit.hits).toBe(1);
    expect(metricsAfterHit.misses).toBe(1);
  });

  it('measures reduction in source computations for N repeated requests (Before vs After)', async () => {
    let computationCount = 0;
    const loader = async () => {
      computationCount++;
      return [{ timestamp: '2026-11-20', revenue: 1200 }];
    };

    const N = 20;
    const opts = { tenantId: 'tenant_1', metric: 'timeSeries', partitionDate: '2026-11-20' };

    // With cache:
    for (let i = 0; i < N; i++) {
      await cache.getOrCompute(opts, loader, mockNow);
    }

    // Baseline without cache would be N computations.
    // With cache, computation runs exactly 1 time!
    expect(computationCount).toBe(1);
    expect(cache.getMetrics().hits).toBe(19);
    expect(cache.getMetrics().misses).toBe(1);
  });

  it('assigns short TTL (60s) to open partition and long TTL (86400s) to closed partition', async () => {
    let openLoads = 0;
    let closedLoads = 0;

    const openOpts = { tenantId: 'tenant_1', metric: 'rev', partitionDate: '2026-11-21' }; // Today -> Open
    const closedOpts = { tenantId: 'tenant_1', metric: 'rev', partitionDate: '2026-11-15' }; // Past -> Closed

    await cache.getOrCompute(openOpts, async () => ++openLoads, mockNow);
    await cache.getOrCompute(closedOpts, async () => ++closedLoads, mockNow);

    expect(openLoads).toBe(1);
    expect(closedLoads).toBe(1);

    // Advance by 61 seconds: open partition should expire, closed partition should still be cached
    vi.advanceTimersByTime(61 * 1000);

    await cache.getOrCompute(openOpts, async () => ++openLoads, new Date(Date.now()));
    await cache.getOrCompute(closedOpts, async () => ++closedLoads, new Date(Date.now()));

    expect(openLoads).toBe(2); // Expired and reloaded
    expect(closedLoads).toBe(1); // Still cached!

    // Advance by 86400 more seconds: closed partition should now expire
    vi.advanceTimersByTime(86400 * 1000);
    await cache.getOrCompute(closedOpts, async () => ++closedLoads, new Date(Date.now()));
    expect(closedLoads).toBe(2);
  });

  it('invalidates open partition and past partition on write/correction', async () => {
    let openCount = 0;
    let pastCount = 0;

    const openOpts = { tenantId: 'tenant_1', metric: 'summary', partitionDate: '2026-11-21' };
    const pastOpts = { tenantId: 'tenant_1', metric: 'summary', partitionDate: '2026-11-10' };

    await cache.getOrCompute(openOpts, async () => ++openCount, mockNow);
    await cache.getOrCompute(pastOpts, async () => ++pastCount, mockNow);

    expect(openCount).toBe(1);
    expect(pastCount).toBe(1);

    // Invalidate the past partition (e.g. late adjustment in 2026-11-10)
    await cache.invalidate({ tenantId: 'tenant_1', partitionDate: '2026-11-10' });

    // Requesting past partition recomputes
    await cache.getOrCompute(pastOpts, async () => ++pastCount, mockNow);
    expect(pastCount).toBe(2);

    // Open partition was unaffected by historical invalidation
    await cache.getOrCompute(openOpts, async () => ++openCount, mockNow);
    expect(openCount).toBe(1);

    // Invalidate open partition (e.g. new payment today)
    await cache.invalidate({ tenantId: 'tenant_1', partitionDate: '2026-11-21' });

    // Open partition recomputes
    await cache.getOrCompute(openOpts, async () => ++openCount, mockNow);
    expect(openCount).toBe(2);
  });

  it('protects against cache stampede via single-flight concurrent execution', async () => {
    let executionCount = 0;
    const slowLoader = async () => {
      executionCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { status: 'complete', count: 99 };
    };

    const opts = { tenantId: 'tenant_1', metric: 'funnel', partitionDate: mockNow };

    // Launch 10 concurrent requests at the exact same moment
    const promises = Array.from({ length: 10 }, () =>
      cache.getOrCompute(opts, slowLoader, mockNow),
    );

    vi.advanceTimersByTime(60);
    const results = await Promise.all(promises);

    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r).toEqual({ status: 'complete', count: 99 });
    }

    // Single-flight ensures the slowLoader was executed only ONCE!
    expect(executionCount).toBe(1);
  });

  it('does NOT cache failed computations', async () => {
    let callCount = 0;
    const failingLoader = async () => {
      callCount++;
      throw new Error('Database connection failed');
    };

    const opts = { tenantId: 'tenant_1', metric: 'summary', partitionDate: mockNow };

    await expect(cache.getOrCompute(opts, failingLoader, mockNow)).rejects.toThrow(
      'Database connection failed',
    );
    expect(callCount).toBe(1);

    // Retry computation with success
    const succeedingLoader = async () => {
      callCount++;
      return { success: true };
    };

    const res = await cache.getOrCompute(opts, succeedingLoader, mockNow);
    expect(res).toEqual({ success: true });
    expect(callCount).toBe(2);
  });

  it('guarantees tenant isolation (tenant A cannot read tenant B cache)', async () => {
    const optsA = { tenantId: 'tenant_A', metric: 'summary', partitionDate: mockNow };
    const optsB = { tenantId: 'tenant_B', metric: 'summary', partitionDate: mockNow };

    await cache.getOrCompute(optsA, async () => ({ revenue: 100 }), mockNow);
    await cache.getOrCompute(optsB, async () => ({ revenue: 999 }), mockNow);

    const valA = await cache.getOrCompute(optsA, async () => ({ revenue: 0 }), mockNow);
    const valB = await cache.getOrCompute(optsB, async () => ({ revenue: 0 }), mockNow);

    expect(valA).toEqual({ revenue: 100 });
    expect(valB).toEqual({ revenue: 999 });

    // Invalidating tenant A does not touch tenant B
    await cache.invalidate({ tenantId: 'tenant_A', partitionDate: mockNow });

    let bReloaded = false;
    const valB2 = await cache.getOrCompute(optsB, async () => {
      bReloaded = true;
      return { revenue: 0 };
    }, mockNow);

    expect(valB2).toEqual({ revenue: 999 });
    expect(bReloaded).toBe(false);
  });

  it('fails open when the cache store errors', async () => {
    // Fake error in LRU by monkey-patching
    const faultyCache = new AnalyticsRollupCache({ enabled: true });
    (faultyCache as any).lru.get = () => {
      throw new Error('Memory access violation');
    };

    let computed = false;
    const loader = async () => {
      computed = true;
      return { value: 12345 };
    };

    const res = await faultyCache.getOrCompute(
      { tenantId: 'tenant_err', metric: 'test', partitionDate: mockNow },
      loader,
      mockNow,
    );

    // Request succeeds with value computed from source!
    expect(res).toEqual({ value: 12345 });
    expect(computed).toBe(true);
    expect(faultyCache.getMetrics().errors).toBeGreaterThan(0);
  });

  it('enforces bounded size LRU eviction', async () => {
    const smallLru = new BoundedLRUCache<number>(3);
    smallLru.set('k1', { value: 1, expiresAt: Date.now() + 10000, createdAt: Date.now(), partition: 'p', tenantId: 't', metric: 'm' });
    smallLru.set('k2', { value: 2, expiresAt: Date.now() + 10000, createdAt: Date.now(), partition: 'p', tenantId: 't', metric: 'm' });
    smallLru.set('k3', { value: 3, expiresAt: Date.now() + 10000, createdAt: Date.now(), partition: 'p', tenantId: 't', metric: 'm' });

    expect(smallLru.size).toBe(3);

    // Access k1 to make it most recently used (k2 becomes oldest)
    smallLru.get('k1');

    // Add k4 -> should evict k2
    smallLru.set('k4', { value: 4, expiresAt: Date.now() + 10000, createdAt: Date.now(), partition: 'p', tenantId: 't', metric: 'm' });

    expect(smallLru.size).toBe(3);
    expect(smallLru.get('k2')).toBeNull();
    expect(smallLru.get('k1')?.value).toBe(1);
    expect(smallLru.get('k3')?.value).toBe(3);
    expect(smallLru.get('k4')?.value).toBe(4);
  });

  it('ignores old entries when schema version is bumped', async () => {
    const v1Cache = new AnalyticsRollupCache({ schemaVersion: 1, maxEntries: 10 });
    const v2Cache = new AnalyticsRollupCache({ schemaVersion: 2, maxEntries: 10 });

    const keyV1 = v1Cache.buildKey({ tenantId: 't1', metric: 'summary', partitionDate: mockNow }, mockNow).key;
    const keyV2 = v2Cache.buildKey({ tenantId: 't1', metric: 'summary', partitionDate: mockNow }, mockNow).key;

    expect(keyV1).toContain(':v1:');
    expect(keyV2).toContain(':v2:');
    expect(keyV1).not.toBe(keyV2);
  });
});
