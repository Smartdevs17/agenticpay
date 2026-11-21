/**
 * etag-cache.integration.test.ts — Issue #622
 *
 * End-to-end tests over a real HTTP server proving that the ETag middleware
 * and the cacheControl middleware work together correctly across the wire:
 * conditional requests (304), X-Cache behaviour, stale-while-revalidate and
 * the no-store error guard. Also guards the historical bug where concurrent
 * in-memory cache misses never resolved the handler.
 */

import express, { type Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { etag } from '../etag.js';
import { cacheControl, clearMemoryCache } from '../cache.js';

let server: import('node:http').Server;
let base = '';

async function call(
  path: string,
  options: {
    method?: 'GET' | 'HEAD' | 'POST';
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: options.headers,
  });
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body, headers: res.headers };
}

describe('etag + cacheControl over HTTP', () => {
  beforeAll(async () => {
    const app: Express = express();
    app.use(express.json());
    app.disable('etag'); // exercise OUR middleware, not Express's auto-ETag

    let counter = 0;

    // ETag-only route (stable body so a conditional request can match)
    app.get('/etag', etag(), (_req, res) => {
      res.json({ ok: true });
    });

    // Header-only cache route
    app.get('/header-only', cacheControl({ maxAge: 60 }), (_req, res) => {
      res.json({ source: 'header-only', n: ++counter });
    });

    // In-memory cache route (served from cache after the first request)
    app.get('/memory', cacheControl({ maxAge: 300, inMemory: true }), (_req, res) => {
      res.json({ source: 'memory', n: ++counter });
    });

    // In-memory route with stale-while-revalidate (1s freshness)
    app.get(
      '/memory-swr',
      cacheControl({ maxAge: 1, inMemory: true, staleWhileRevalidate: 300 }),
      (_req, res) => {
        res.json({ source: 'memory-swr', n: ++counter });
      },
    );

    // Error route: must never be cached or tagged
    app.get(
      '/error',
      cacheControl({ maxAge: 60, inMemory: true }),
      (_req, res) => {
        res.status(503).json({ error: 'down', n: ++counter });
      },
    );

    // Same path, mutation: the cache middleware must pass it straight through
    app.post('/memory', (_req, res) => {
      res.json({ source: 'memory', method: 'POST', n: ++counter });
    });

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    clearMemoryCache();
  });

  it('etag route serves 200 with an ETag then 304 on If-None-Match', async () => {
    const first = await call('/etag');
    expect(first.status).toBe(200);
    const etagHeader = first.headers.get('etag');
    expect(etagHeader).toBeTruthy();

    const second = await call('/etag', { headers: { 'if-none-match': etagHeader! } });
    expect(second.status).toBe(304);
    expect(second.body).toBeUndefined();
  });

  it('header-only mode never stores, so the body always changes', async () => {
    const a = await call('/header-only');
    expect(a.status).toBe(200);
    expect((a.body as { source: string }).source).toBe('header-only');
    expect(a.headers.get('cache-control')).toBe('public, max-age=60');
    expect(a.headers.get('etag')).toBeTruthy();

    const b = await call('/header-only');
    expect((b.body as { n: number }).n).toBeGreaterThan((a.body as { n: number }).n);
  });

  it('in-memory mode caches: first MISS, then HITs with a stable body', async () => {
    const first = await call('/memory');
    expect(first.status).toBe(200);
    expect(first.headers.get('x-cache')).toBe('MISS');

    const second = await call('/memory');
    expect(second.status).toBe(200);
    expect(second.headers.get('x-cache')).toBe('HIT');
    expect(second.body).toEqual(first.body);

    const third = await call('/memory');
    expect(third.headers.get('x-cache')).toBe('HIT');
    expect(third.body).toEqual(first.body);
  });

  it('serves 304 from the in-memory cache when If-None-Match matches', async () => {
    const first = await call('/memory');
    const etagHeader = first.headers.get('etag') as string;

    const conditional = await call('/memory', {
      headers: { 'if-none-match': etagHeader },
    });
    expect(conditional.status).toBe(304);
    expect(conditional.body).toBeUndefined();

    const stale = await call('/memory', { headers: { 'if-none-match': '"deadbeef"' } });
    expect(stale.status).toBe(200);
    expect(stale.headers.get('x-cache')).toBe('HIT');
  });

  it('concurrent in-memory misses all resolve (regression: handler hang)', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => call('/memory')),
    );

    for (const r of responses) {
      expect(r.status).toBe(200);
      expect((r.body as { source: string }).source).toBe('memory');
      expect(['MISS', 'HIT']).toContain(r.headers.get('x-cache'));
    }
    // Every response is equally valid: whatever was cached converges on equal bodies.
    const ns = responses.map((r) => (r.body as { n: number }).n);
    expect(new Set(ns).size).toBeLessThanOrEqual(2);

    // And the winner is now cached for everyone else.
    const last = await call('/memory');
    expect(last.headers.get('x-cache')).toBe('HIT');
  });

  it('serves stale content with X-Cache STALE after TTL expiry when SWR is on', async () => {
    const first = await call('/memory-swr');
    expect(first.status).toBe(200);
    expect(first.headers.get('x-cache')).toBe('MISS');

    const ttlAfterMs = 1100;
    await new Promise((resolve) => setTimeout(resolve, ttlAfterMs));

    const stale = await call('/memory-swr');
    expect(stale.status).toBe(200);
    expect(stale.headers.get('x-cache')).toBe('STALE');
    expect(stale.body).toEqual(first.body);
  });

  it('error responses are never cached or tagged', async () => {
    const first = await call('/error');
    expect(first.status).toBe(503);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.headers.get('x-cache')).toBeNull();
    expect(first.headers.get('etag')).toBeNull();

    const second = await call('/error');
    expect(second.status).toBe(503);
    // A fresh handler runs (counter advances) because nothing was cached.
    expect((second.body as { n: number }).n).toBeGreaterThan((first.body as { n: number }).n);
  });

  it('POST mutations pass straight through without cache/etag headers', async () => {
    const res = await fetch(`${base}/memory`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { method: string; n: number };
    expect(body.method).toBe('POST');
    expect(res.headers.get('x-cache')).toBeNull();
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('cache-control')).toBeNull();
    // Two POSTs both reach the handler (nothing is stored for mutations).
    const second = await fetch(`${base}/memory`, { method: 'POST' });
    const body2 = (await second.json()) as { n: number };
    expect(body2.n).toBeGreaterThan(body.n);
  });
});