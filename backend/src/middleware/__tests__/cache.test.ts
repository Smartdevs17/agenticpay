/**
 * cache.test.ts
 *
 * Unit tests for the cache module: CacheTTL constants, MemoryCache,
 * SingleFlight, CacheMonitor, warmCache/invalidation helpers and the
 * cacheControl() middleware (header-only + in-memory modes).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import {
  cacheControl,
  CacheTTL,
  getCacheMonitor,
  getRedisCache,
  getMemoryCache,
  getSingleFlight,
  warmCache,
  getWarmedKeys,
  invalidateCache,
  clearMemoryCache,
} from '../cache.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    headers: {},
    originalUrl: '/api/test',
    ...overrides,
  } as unknown as Request;
}

function makeRes(): {
  res: Response & EventEmitter;
  headers: Record<string, string | number>;
  sentStatus: number | null;
  sentBody: unknown;
  jsonCalled: boolean;
  emitFinish: () => void;
} {
  const headers: Record<string, string | number> = {};
  let sentStatus: number | null = null;
  let sentBody: unknown = undefined;
  let jsonCalled = false;

  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    statusCode: 200,
    setHeader: vi.fn((name: string, value: string | number) => {
      headers[name] = value;
    }),
    getHeader: vi.fn((name: string): string | number | undefined => {
      return headers[name];
    }),
    status: vi.fn(function (code: number) {
      res.statusCode = code;
      sentStatus = code;
      return res;
    }),
    end: vi.fn(),
    json: vi.fn(function (body: unknown) {
      jsonCalled = true;
      sentBody = body;
      return res;
    }),
  }) as unknown as Response & EventEmitter;

  // Vitest mocks wipe `on`; re-add the EventEmitter binding for 'finish'.
  res.on = emitter.on.bind(emitter);

  return {
    res,
    headers,
    get sentStatus() { return sentStatus; },
    get sentBody() { return sentBody; },
    get jsonCalled() { return jsonCalled; },
    emitFinish: () => emitter.emit('finish'),
  };
}

beforeEach(() => {
  clearMemoryCache();
  getCacheMonitor().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─── CacheTTL constants ───────────────────────────────────────────────────────

describe('CacheTTL constants', () => {
  it('exposes the full TTL ladder', () => {
    expect(CacheTTL.STATIC).toBe(300);
    expect(CacheTTL.SHORT).toBe(30);
    expect(CacheTTL.IMMUTABLE).toBe(600);
    expect(CacheTTL.LONG).toBe(3600);
    expect(CacheTTL.NONE).toBe(0);
  });
});

// ─── MemoryCache ──────────────────────────────────────────────────────────────

describe('MemoryCache', () => {
  it('round-trips values and reports them fresh', () => {
    const cache = getMemoryCache();
    cache.set('a:1', { hello: 'world' }, 60_000, '"etag"');
    const got = cache.get<{ hello: string }>('a:1');
    expect(got).not.toBeNull();
    expect(got?.value).toEqual({ hello: 'world' });
    expect(got?.stale).toBe(false);
    expect(got?.etag).toBe('"etag"');
    expect(cache.size).toBe(1);
  });

  it('returns null for unknown keys', () => {
    expect(getMemoryCache().get('missing')).toBeNull();
  });

  it('reports entries as stale once expired', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const cache = getMemoryCache();
    cache.set('t:1', { v: 1 }, 1000);
    expect(cache.get('t:1')?.stale).toBe(false);

    vi.setSystemTime(1_001_001);
    expect(cache.get('t:1')?.stale).toBe(true);
  });

  it('increments hitCount on every read', () => {
    const cache = getMemoryCache();
    cache.set('h:1', 1, 60_000);
    cache.get('h:1');
    cache.get('h:1');
    expect(cache.getStats().totalHits).toBe(2);
  });

  it('evicts only expired entries', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(5_000_000);
    const cache = getMemoryCache();
    cache.set('expired', 1, 100);
    cache.set('alive', 2, 1000);

    vi.setSystemTime(5_000_200);
    const evicted = cache.evictExpired();

    expect(evicted).toBe(1);
    expect(cache.has('expired')).toBe(false);
    expect(cache.has('alive')).toBe(true);
  });

  it('deletes individual keys', () => {
    const cache = getMemoryCache();
    cache.set('d:1', 1, 60_000);
    cache.delete('d:1');
    expect(cache.has('d:1')).toBe(false);
  });

  it('clears the store', () => {
    const cache = getMemoryCache();
    cache.set('c:1', 1, 60_000);
    cache.set('c:2', 2, 60_000);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('evicts the oldest entry past its capacity', () => {
    const cache = getMemoryCache();
    const maxSize = cache.getStats().maxSize;
    cache.set('first', 'a', 60_000);
    for (let i = 0; i < maxSize; i++) {
      cache.set(`filler-${i}`, i, 60_000);
    }
    expect(cache.size).toBe(maxSize);
    expect(cache.has('first')).toBe(false);
    expect(cache.has('filler-0')).toBe(true);
  });

  it('exposes keys and stats', () => {
    const cache = getMemoryCache();
    cache.set('k:1', 1, 60_000);
    cache.set('k:2', 2, 60_000);
    expect([...cache.keys()].sort()).toEqual(['k:1', 'k:2']);
    const stats = cache.getStats();
    expect(stats.totalEntries).toBe(2);
    expect(stats.avgHitsPerEntry).toBe(0);
  });
});

// ─── SingleFlight ─────────────────────────────────────────────────────────────

describe('SingleFlight', () => {
  it('coalesces concurrent work for the same key', async () => {
    const sf = getSingleFlight();
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return calls;
    };

    const [a, b, c] = await Promise.all([
      sf.execute('k', fn),
      sf.execute('k', fn),
      sf.execute('k', fn),
    ]);

    expect(calls).toBe(1);
    expect([a, b, c]).toEqual([1, 1, 1]);
    expect(sf.inFlightCount).toBe(0);
  });

  it('runs different keys independently', async () => {
    const sf = getSingleFlight();
    let calls = 0;
    const fn = async () => ++calls;

    const [a, b] = await Promise.all([
      sf.execute('x', fn),
      sf.execute('y', fn),
    ]);

    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it('clears the in-flight map even when the work rejects', async () => {
    const sf = getSingleFlight();
    await expect(
      sf.execute('boom', () => Promise.reject(new Error('nope'))),
    ).rejects.toThrow('nope');
    expect(sf.inFlightCount).toBe(0);
  });
});

// ─── CacheMonitor ─────────────────────────────────────────────────────────────

describe('CacheMonitor', () => {
  it('tracks hits, misses, sets and evictions', () => {
    const monitor = getCacheMonitor();
    monitor.recordHit();
    monitor.recordHit();
    monitor.recordMiss();
    monitor.recordSet();
    monitor.recordEviction();

    const stats = monitor.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.sets).toBe(1);
    expect(stats.evictions).toBe(1);
  });

  it('computes a hit ratio', () => {
    const monitor = getCacheMonitor();
    monitor.reset();
    monitor.recordHit();
    monitor.recordHit();
    monitor.recordMiss();
    expect(monitor.hitRatio).toBeCloseTo(2 / 3);
  });

  it('reset zeroes the counters', () => {
    const monitor = getCacheMonitor();
    monitor.recordHit();
    monitor.reset();
    expect(monitor.hitRatio).toBe(0);
    expect(monitor.getStats().hits).toBe(0);
  });

  it('empty monitor has a zero hit ratio', () => {
    const monitor = getCacheMonitor();
    monitor.reset();
    expect(monitor.hitRatio).toBe(0);
  });
});

// ─── warmCache / invalidation helpers ─────────────────────────────────────────

describe('warmCache / invalidation', () => {
  it('warms a value into the memory cache', async () => {
    warmCache('warm:1', async () => ({ data: 'hot' }), 60_000);
    await vi.waitFor(() => {
      expect(getMemoryCache().get('warm:1')).not.toBeNull();
    });
    expect(getMemoryCache().get<{ data: string }>('warm:1')?.value).toEqual({ data: 'hot' });
    expect(getWarmedKeys()).toContain('warm:1');
  });

  it('does not warm the same key twice', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return { n: calls };
    };
    warmCache('warm:2', fn, 60_000);
    warmCache('warm:2', fn, 60_000);
    await vi.waitFor(() => {
      expect(getMemoryCache().get('warm:2')).not.toBeNull();
    });
    expect(calls).toBe(1);
  });

  it('drops the key from the warmed set when the fetch fails', async () => {
    warmCache('warm:fail', () => Promise.reject(new Error('nope')), 60_000);
    await vi.waitFor(() => {
      expect(getWarmedKeys()).not.toContain('warm:fail');
    });
    expect(getMemoryCache().has('warm:fail')).toBe(false);
  });

  it('computes an ETag when the warmed value is JSON-serialisable', async () => {
    warmCache('warm:etag', async () => ({ ok: true }), 60_000);
    await vi.waitFor(() => {
      expect(getMemoryCache().get('warm:etag')).not.toBeNull();
    });
    expect(getMemoryCache().get('warm:etag')?.etag).toMatch(/^"[0-9a-f]{16}"$/);
  });

  it('falls back to an empty ETag when the warmed value is not serialisable', async () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    warmCache('warm:circ', async () => circular, 60_000);
    await vi.waitFor(() => {
      expect(getMemoryCache().has('warm:circ')).toBe(true);
    });
    expect(getMemoryCache().get('warm:circ')?.etag).toBe('');
  });

  it('invalidateCache removes matching keys and leaves others intact', async () => {
    const cache = getMemoryCache();
    cache.set('agenticpay:cache:GET:/api/catalog', 1, 60_000);
    cache.set('agenticpay:cache:GET:/api/other', 2, 60_000);

    await invalidateCache('GET:/api/catalog*');

    expect(cache.has('agenticpay:cache:GET:/api/catalog')).toBe(false);
    expect(cache.has('agenticpay:cache:GET:/api/other')).toBe(true);
  });

  it('clearMemoryCache empties the store and warmed keys', async () => {
    getMemoryCache().set('x', 1, 60_000);
    warmCache('warm:clear', async () => 1, 60_000);
    await vi.waitFor(() => {
      expect(getWarmedKeys()).toContain('warm:clear');
    });
    clearMemoryCache();
    expect(getMemoryCache().size).toBe(0);
    expect(getWarmedKeys()).toEqual([]);
  });
});

// ─── cacheControl() middleware — header-only mode ─────────────────────────────

describe('cacheControl() middleware (header-only)', () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  it('sets public Cache-Control with max-age for a normal GET', () => {
    const req = makeReq();
    const { res, headers } = makeRes();
    const mw = cacheControl({ maxAge: 300 });

    mw(req, res, next);
    (res.json as unknown as ReturnType<typeof vi.fn>)({ data: 1 });

    expect(headers['Cache-Control']).toBe('public, max-age=300');
    expect(next).toHaveBeenCalledOnce();
  });

  it('sets private Cache-Control when isPublic is false', () => {
    const req = makeReq();
    const { res, headers } = makeRes();

    cacheControl({ maxAge: 60, isPublic: false })(req, res, next);
    (res.json as unknown as ReturnType<typeof vi.fn>)({ data: 1 });

    expect(headers['Cache-Control']).toBe('private, max-age=60');
  });

  it('appends stale-while-revalidate when provided', () => {
    const req = makeReq();
    const { res, headers } = makeRes();

    cacheControl({ maxAge: 300, staleWhileRevalidate: 60 })(req, res, next);
    (res.json as unknown as ReturnType<typeof vi.fn>)({ ok: true });

    expect(headers['Cache-Control']).toBe('public, max-age=300, stale-while-revalidate=60');
  });

  it('sets no-store when maxAge is 0', () => {
    const req = makeReq();
    const { res, headers } = makeRes();

    cacheControl({ maxAge: CacheTTL.NONE })(req, res, next);
    (res.json as unknown as ReturnType<typeof vi.fn>)({});

    expect(headers['Cache-Control']).toBe('no-store');
  });

  it('sets an ETag header on the response', () => {
    const req = makeReq();
    const { res, headers } = makeRes();

    cacheControl({ maxAge: 30 })(req, res, next);
    (res.json as unknown as ReturnType<typeof vi.fn>)({ value: 42 });

    expect(headers['ETag']).toMatch(/^"[0-9a-f]{16}"$/);
  });

  it('produces the same ETag for identical bodies and different for different bodies', () => {
    const call = (body: unknown) => {
      const req = makeReq();
      const { res, headers } = makeRes();
      cacheControl({ maxAge: 60 })(req, res, next);
      (res.json as unknown as ReturnType<typeof vi.fn>)(body);
      return headers['ETag'];
    };

    const body = { name: 'agenticpay', version: 1 };
    expect(call(body)).toBe(call(body));
    expect(call({ a: 1 })).not.toBe(call({ a: 2 }));
  });

  it('returns 304 when If-None-Match matches exactly', () => {
    const body = { catalog: [] };
    const reqA = makeReq();
    const { res: resA, headers } = makeRes();
    cacheControl({ maxAge: 300 })(reqA, resA, next);
    (resA.json as unknown as ReturnType<typeof vi.fn>)(body);
    const etag = headers['ETag'] as string;

    const reqB = makeReq({ headers: { 'if-none-match': etag } });
    const { res: resB } = makeRes();
    cacheControl({ maxAge: 300 })(reqB, resB, next);
    (resB.json as unknown as ReturnType<typeof vi.fn>)(body);

    expect((resB.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(304);
    expect((resB.end as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('returns 304 when the client sends a weak variant of the ETag', () => {
    const body = { x: 1 };
    const reqA = makeReq();
    const { res: resA, headers } = makeRes();
    cacheControl({ maxAge: 60 })(reqA, resA, next);
    (resA.json as unknown as ReturnType<typeof vi.fn>)(body);
    const etag = (headers['ETag'] as string).replace(/^"/, 'W/"');

    const reqB = makeReq({ headers: { 'if-none-match': etag } });
    const { res: resB } = makeRes();
    cacheControl({ maxAge: 60 })(reqB, resB, next);
    (resB.json as unknown as ReturnType<typeof vi.fn>)(body);

    expect((resB.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(304);
  });

  it('returns 304 for a wildcard If-None-Match (*)', () => {
    const req = makeReq({ headers: { 'if-none-match': '*' } });
    const { res } = makeRes();

    cacheControl({ maxAge: 60 })(req, res, next);
    (res.json as unknown as ReturnType<typeof vi.fn>)({ data: 1 });

    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(304);
  });

  it('returns 304 when a comma-separated list contains a match', () => {
    const body = { data: 'listed' };
    const reqA = makeReq();
    const { res: resA, headers } = makeRes();
    cacheControl({ maxAge: 60 })(reqA, resA, next);
    (resA.json as unknown as ReturnType<typeof vi.fn>)(body);
    const etag = headers['ETag'] as string;

    const reqB = makeReq({ headers: { 'if-none-match': `"old", ${etag}` } });
    const { res: resB } = makeRes();
    cacheControl({ maxAge: 60 })(reqB, resB, next);
    (resB.json as unknown as ReturnType<typeof vi.fn>)(body);

    expect((resB.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(304);
  });

  it('does NOT return 304 when If-None-Match does not match', () => {
    const req = makeReq({ headers: { 'if-none-match': '"outdatedETagValue"' } });
    const { res } = makeRes();

    cacheControl({ maxAge: 60 })(req, res, next);
    (res.json as unknown as ReturnType<typeof vi.fn>)({ updated: true });

    expect((res.status as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalledWith(304);
  });

  it('marks error responses as no-store and skips ETag logic', () => {
    const req = makeReq();
    const { res, headers } = makeRes();
    (res.status as unknown as ReturnType<typeof vi.fn>)(503);

    cacheControl({ maxAge: 300 })(req, res, next);
    (res.json as unknown as ReturnType<typeof vi.fn>)({ error: 'down' });

    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers['ETag']).toBeUndefined();
    expect((res.status as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalledWith(304);
  });

  it('passes POST requests straight through without touching res.json', () => {
    const req = makeReq({ method: 'POST' });
    const { res } = makeRes();
    const originalJson = res.json;

    cacheControl({ maxAge: 300 })(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.json).toBe(originalJson);
  });

  it('passes DELETE requests straight through', () => {
    const req = makeReq({ method: 'DELETE' });
    const { res } = makeRes();
    const originalJson = res.json;

    cacheControl({ maxAge: 300 })(req, res, next);

    expect(res.json).toBe(originalJson);
  });

  it('intercepts HEAD requests the same as GET', () => {
    const req = makeReq({ method: 'HEAD' });
    const { res, headers } = makeRes();

    cacheControl({ maxAge: 120 })(req, res, next);
    (res.json as unknown as ReturnType<typeof vi.fn>)({});

    expect(headers['Cache-Control']).toBe('public, max-age=120');
  });
});

// ─── cacheControl() middleware — in-memory mode ───────────────────────────────

describe('cacheControl() middleware (in-memory)', () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  it('serves a MISS on the first request and stores the response on finish', () => {
    const req = makeReq();
    const { res, headers, emitFinish } = makeRes();
    const mw = cacheControl({ maxAge: 300, inMemory: true });

    mw(req, res, next);
    (res.json as unknown as ReturnType<typeof vi.fn>)({ version: '1' });
    emitFinish();

    expect(headers['X-Cache']).toBe('MISS');
    expect(headers['ETag']).toMatch(/^"[0-9a-f]{16}"$/);
    expect(getMemoryCache().size).toBe(1);
    expect(getCacheMonitor().getStats().sets).toBe(1);
  });

  it('serves cached values with X-Cache HIT and skips the handler', () => {
    // Prime the cache like a previous request would have
    const primeReq = makeReq();
    const prime = makeRes();
    cacheControl({ maxAge: 300, inMemory: true })(primeReq, prime.res, vi.fn());
    (prime.res.json as unknown as ReturnType<typeof vi.fn>)({ version: '1' });
    prime.emitFinish();

    const req = makeReq();
    const hit = makeRes();
    const mw = cacheControl({ maxAge: 300, inMemory: true });

    mw(req, hit.res, next);

    expect(hit.headers['X-Cache']).toBe('HIT');
    expect(hit.headers['Cache-Control']).toBe('public, max-age=300');
    expect(hit.headers['ETag']).toMatch(/^"[0-9a-f]{16}"$/);
    expect(hit.sentBody).toEqual({ version: '1' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 304 for a matching If-None-Match when serving from cache', () => {
    const primeReq = makeReq();
    const prime = makeRes();
    cacheControl({ maxAge: 300, inMemory: true })(primeReq, prime.res, vi.fn());
    (prime.res.json as unknown as ReturnType<typeof vi.fn>)({ version: '1' });
    prime.emitFinish();
    const etag = prime.headers['ETag'] as string;

    const req = makeReq({ headers: { 'if-none-match': etag } });
    const hit = makeRes();
    cacheControl({ maxAge: 300, inMemory: true })(req, hit.res, next);

    expect((hit.res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(304);
    expect((hit.res.end as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('serves stale content with X-Cache STALE when stale-while-revalidate > 0', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(2_000_000);
    const body = { version: 'old' };

    const primeReq = makeReq();
    const prime = makeRes();
    cacheControl({ maxAge: 300, inMemory: true, staleWhileRevalidate: 60 })(
      primeReq,
      prime.res,
      vi.fn(),
    );
    (prime.res.json as unknown as ReturnType<typeof vi.fn>)(body);
    prime.emitFinish();

    vi.setSystemTime(2_000_000 + 300 * 1000 + 1);

    const req = makeReq();
    const hit = makeRes();
    cacheControl({ maxAge: 300, inMemory: true, staleWhileRevalidate: 60 })(
      req,
      hit.res,
      next,
    );

    expect(hit.headers['X-Cache']).toBe('STALE');
    expect(hit.sentBody).toEqual(body);
  });

  it('re-runs the handler for stale entries when no SWR is configured', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(3_000_000);

    const primeReq = makeReq();
    const prime = makeRes();
    cacheControl({ maxAge: 1, inMemory: true })(primeReq, prime.res, vi.fn());
    (prime.res.json as unknown as ReturnType<typeof vi.fn>)({ version: 'old' });
    prime.emitFinish();

    vi.setSystemTime(3_000_000 + 1_001);

    const req = makeReq();
    const hit = makeRes();
    cacheControl({ maxAge: 1, inMemory: true })(req, hit.res, next);
    (hit.res.json as unknown as ReturnType<typeof vi.fn>)({ version: 'new' });
    hit.res.emit('finish');

    expect(hit.headers['X-Cache']).toBe('MISS');
    expect(next).toHaveBeenCalledOnce();
    expect(getMemoryCache().get('agenticpay:cache:GET:/api/test')?.value).toEqual({
      version: 'new',
    });
  });

  it('returns 304 for a matching If-None-Match on an in-memory miss', () => {
    const body = { data: 'conditional' };
    const reqA = makeReq();
    const resA = makeRes();
    cacheControl({ maxAge: 300, inMemory: true })(reqA, resA.res, next);
    (resA.res.json as unknown as ReturnType<typeof vi.fn>)(body);
    const etag = resA.headers['ETag'] as string;

    const reqB = makeReq({ headers: { 'if-none-match': etag } });
    const { res: resB } = makeRes();
    cacheControl({ maxAge: 300, inMemory: true })(reqB, resB, next);
    (resB.json as unknown as ReturnType<typeof vi.fn>)(body);

    expect((resB.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(304);
  });

  it('does not cache error responses in in-memory mode', () => {
    const req = makeReq();
    const { res, headers } = makeRes();
    (res.status as unknown as ReturnType<typeof vi.fn>)(500);

    cacheControl({ maxAge: 300, inMemory: true })(req, res, next);
    (res.json as unknown as ReturnType<typeof vi.fn>)({ error: 'nope' });
    res.emit('finish');

    expect(headers['X-Cache']).toBeUndefined();
    expect(headers['Cache-Control']).toBe('no-store');
    expect(getMemoryCache().size).toBe(0);
    expect(getCacheMonitor().getStats().sets).toBe(0);
  });

  it('does not cache responses that exceed maxBodySize', () => {
    const req = makeReq();
    const { res, headers } = makeRes();

    cacheControl({ maxAge: 300, inMemory: true, maxBodySize: 8 })(req, res, next);
    (res.json as unknown as ReturnType<typeof vi.fn>)({ payload: 'significantly-bigger' });
    res.emit('finish');

    expect(headers['X-Cache']).toBeUndefined();
    expect(getMemoryCache().size).toBe(0);
  });

  it('honours a fixed cacheKey override', () => {
    const req = makeReq();
    const { res, emitFinish } = makeRes();

    cacheControl({ maxAge: 60, inMemory: true, cacheKey: 'shared!key' })(req, res, next);
    (res.json as unknown as ReturnType<typeof vi.fn>)({ v: 1 });
    emitFinish();

    expect(getMemoryCache().has('agenticpay:cache:shared!key')).toBe(true);
  });

  it('degrades gracefully when Redis is not configured', async () => {
    const prevUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    const redisCache = getRedisCache();

    await redisCache.connect();
    expect(redisCache.isEnabled).toBe(false);

    // Every operation becomes a safe no-op when disabled.
    await redisCache.set('k', { v: 1 }, 1000);
    expect(await redisCache.get('k')).toBeNull();
    await redisCache.invalidate('*');
    await redisCache.invalidateAll();
    expect(await redisCache.getMemoryInfo()).toBeNull();

    if (prevUrl !== undefined) process.env.REDIS_URL = prevUrl;
  });
});

// ─── RedisCache resilience (white-box: injected fake client) ─────────────────

describe('RedisCache resilience', () => {
  it('runs every operation against a fake client and degrades silently on failure', async () => {
    const redisCache = getRedisCache();
    const internals = redisCache as unknown as { client: unknown; enabled: boolean };

    const fake = {
      get: vi.fn(async () => JSON.stringify({ v: 1 })),
      setex: vi.fn(async () => 'OK'),
      del: vi.fn(async () => 1),
      keys: vi.fn(async () => ['agenticpay:cache:a']),
      flushdb: vi.fn(async () => 'OK'),
      info: vi.fn(async (section: string) =>
        section === 'memory'
          ? 'used_memory_human:1.00M\nmaxmemory_human:256.00M\n'
          : 'keyspace_hits:4\nkeyspace_misses:1\n',
      ),
    };

    internals.enabled = true;
    internals.client = fake;

    try {
      await redisCache.set('k', { v: 1 }, 1);
      expect(fake.setex).toHaveBeenCalledWith('k', 1, JSON.stringify({ v: 1 }));
      expect(await redisCache.get('k')).toEqual({ v: 1 });

      await redisCache.invalidate('GET:*');
      expect(fake.del).toHaveBeenCalledTimes(1);

      fake.keys.mockResolvedValueOnce([]);
      await redisCache.invalidate('GET:none*');
      expect(fake.del).toHaveBeenCalledTimes(1);

      await redisCache.invalidateAll();
      expect(fake.flushdb).toHaveBeenCalled();

      expect(await redisCache.getMemoryInfo()).toEqual({
        usedMemory: '1.00M',
        maxMemory: '256.00M',
        hitRatio: 0.8,
      });

      fake.info.mockImplementation(async (s: string) => (s === 'memory'
        ? 'used_memory_human:2.00M\nmaxmemory_human:512.00M\n'
        : ''));
      expect((await redisCache.getMemoryInfo())?.hitRatio).toBe(0);

      fake.info.mockImplementation(async () => 'junk');
      const junk = await redisCache.getMemoryInfo();
      expect(junk?.usedMemory).toBe('?');
      expect(junk?.maxMemory).toBe('?');

      fake.get.mockRejectedValueOnce(new Error('x'));
      expect(await redisCache.get('k')).toBeNull();
      fake.info.mockImplementation(async () => {
        throw new Error('x');
      });
      expect(await redisCache.getMemoryInfo()).toBeNull();
      fake.setex.mockRejectedValueOnce(new Error('x'));
      await expect(redisCache.set('k', 1, 1)).resolves.toBeUndefined();
    } finally {
      internals.client = null;
      internals.enabled = false;
    }
  });
});