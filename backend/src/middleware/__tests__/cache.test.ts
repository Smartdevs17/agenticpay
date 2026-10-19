/**
 * cache.test.ts
 *
 * Unit tests for the cacheControl() middleware and CacheTTL constants.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { cacheControl, CacheTTL } from '../cache.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): {
  res: Response;
  headers: Record<string, string | number>;
  sentStatus: number | null;
  sentBody: unknown;
  jsonCalled: boolean;
} {
  const headers: Record<string, string | number> = {};
  let sentStatus: number | null = null;
  let sentBody: unknown = undefined;
  let jsonCalled = false;

  const res = {
    setHeader: vi.fn((name: string, value: string | number) => {
      headers[name] = value;
    }),
    status: vi.fn(function (code: number) {
      sentStatus = code;
      return res;
    }),
    end: vi.fn(),
    json: vi.fn(function (body: unknown) {
      jsonCalled = true;
      sentBody = body;
      return res;
    }),
  } as unknown as Response;

  return { res, headers, get sentStatus() { return sentStatus; }, get sentBody() { return sentBody; }, get jsonCalled() { return jsonCalled; } };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CacheTTL constants', () => {
  it('STATIC is 300 seconds', () => expect(CacheTTL.STATIC).toBe(300));
  it('SHORT is 30 seconds',   () => expect(CacheTTL.SHORT).toBe(30));
  it('IMMUTABLE is 600 seconds', () => expect(CacheTTL.IMMUTABLE).toBe(600));
  it('NONE is 0',             () => expect(CacheTTL.NONE).toBe(0));
});

describe('cacheControl() middleware', () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  // ── Cache-Control header ────────────────────────────────────────────────────

  it('sets public Cache-Control with max-age for a normal GET', () => {
    const req = makeReq();
    const { res, headers } = makeRes();
    const mw = cacheControl({ maxAge: 300 });

    mw(req, res, next);
    (res.json as ReturnType<typeof vi.fn>)({ data: 1 });

    expect(headers['Cache-Control']).toBe('public, max-age=300');
    expect(next).toHaveBeenCalledOnce();
  });

  it('sets private Cache-Control when isPublic is false', () => {
    const req = makeReq();
    const { res, headers } = makeRes();
    const mw = cacheControl({ maxAge: 60, isPublic: false });

    mw(req, res, next);
    (res.json as ReturnType<typeof vi.fn>)({ data: 1 });

    expect(headers['Cache-Control']).toBe('private, max-age=60');
  });

  it('appends stale-while-revalidate when provided', () => {
    const req = makeReq();
    const { res, headers } = makeRes();
    const mw = cacheControl({ maxAge: 300, staleWhileRevalidate: 60 });

    mw(req, res, next);
    (res.json as ReturnType<typeof vi.fn>)({ ok: true });

    expect(headers['Cache-Control']).toBe('public, max-age=300, stale-while-revalidate=60');
  });

  it('sets no-store when maxAge is 0', () => {
    const req = makeReq();
    const { res, headers } = makeRes();
    const mw = cacheControl({ maxAge: CacheTTL.NONE });

    mw(req, res, next);
    (res.json as ReturnType<typeof vi.fn>)({});

    expect(headers['Cache-Control']).toBe('no-store');
  });

  // ── ETag header ─────────────────────────────────────────────────────────────

  it('sets an ETag header on the response', () => {
    const req = makeReq();
    const { res, headers } = makeRes();
    const mw = cacheControl({ maxAge: 30 });

    mw(req, res, next);
    (res.json as ReturnType<typeof vi.fn>)({ value: 42 });

    expect(headers['ETag']).toMatch(/^"[0-9a-f]{16}"$/);
  });

  it('produces the same ETag for identical bodies', () => {
    const body = { name: 'agenticpay', version: 1 };

    const makeCall = () => {
      const req = makeReq();
      const { res, headers } = makeRes();
      const mw = cacheControl({ maxAge: 60 });
      mw(req, res, next);
      (res.json as ReturnType<typeof vi.fn>)(body);
      return headers['ETag'];
    };

    expect(makeCall()).toBe(makeCall());
  });

  it('produces different ETags for different bodies', () => {
    const makeCall = (body: unknown) => {
      const req = makeReq();
      const { res, headers } = makeRes();
      const mw = cacheControl({ maxAge: 60 });
      mw(req, res, next);
      (res.json as ReturnType<typeof vi.fn>)(body);
      return headers['ETag'];
    };

    expect(makeCall({ a: 1 })).not.toBe(makeCall({ a: 2 }));
  });

  // ── Conditional GET / 304 ───────────────────────────────────────────────────

  it('returns 304 and skips body when If-None-Match matches the ETag', () => {
    const body = { catalog: [] };

    // First request — get the ETag
    const reqA = makeReq();
    const { res: resA, headers: headersA } = makeRes();
    cacheControl({ maxAge: 300 })(reqA, resA, vi.fn());
    (resA.json as ReturnType<typeof vi.fn>)(body);
    const etag = headersA['ETag'] as string;

    // Second request — client sends the ETag back
    const reqB = makeReq({ headers: { 'if-none-match': etag } as any });
    const { res: resB, headers: headersB } = makeRes();
    cacheControl({ maxAge: 300 })(reqB, resB, vi.fn());
    (resB.json as ReturnType<typeof vi.fn>)(body);

    expect((resB.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(304);
    expect((resB.end as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    // ETag header should still be set even on 304
    expect(headersB['ETag']).toMatch(/^"[0-9a-f]{16}"$/);
  });

  it('does NOT return 304 when If-None-Match does not match', () => {
    const req = makeReq({ headers: { 'if-none-match': '"outdatedETagValue"' } as any });
    const { res } = makeRes();

    cacheControl({ maxAge: 60 })(req, res, next);
    (res.json as ReturnType<typeof vi.fn>)({ updated: true });

    expect((res.status as ReturnType<typeof vi.fn>)).not.toHaveBeenCalledWith(304);
  });

  // ── Non-GET passthrough ─────────────────────────────────────────────────────

  it('calls next() without modifying res.json for POST requests', () => {
    const req = makeReq({ method: 'POST' });
    const { res } = makeRes();
    const originalJson = res.json;

    cacheControl({ maxAge: 300 })(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    // res.json should NOT have been replaced (POST is not intercepted)
    expect(res.json).toBe(originalJson);
  });

  it('calls next() without modifying res.json for DELETE requests', () => {
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
    (res.json as ReturnType<typeof vi.fn>)({});

    expect(headers['Cache-Control']).toBe('public, max-age=120');
  });
});
