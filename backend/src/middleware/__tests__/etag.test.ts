/**
 * etag.test.ts — Issue #622
 *
 * Unit tests for the ETag middleware covering:
 *   - ETag generation from response content
 *   - If-None-Match header handling
 *   - 304 Not Modified responses
 *   - Weak vs strong comparison
 *   - Cache bypass for authenticated requests
 *   - ETag collision resistance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import {
  etag,
  generateETag,
  parseIfNoneMatch,
  weakMatch,
  strongMatch,
  getETagMetrics,
  resetETagMetrics,
} from '../etag.js';

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
  res: Response;
  headers: Record<string, string | number>;
  sentStatus: number | null;
  sentBody: unknown;
  jsonCalled: boolean;
  endCalled: boolean;
} {
  const headers: Record<string, string | number> = {};
  let sentStatus: number | null = null;
  let sentBody: unknown = undefined;
  let jsonCalled = false;
  let endCalled = false;

  const res = {
    setHeader: vi.fn((name: string, value: string | number) => {
      headers[name] = value;
    }),
    status: vi.fn(function (code: number) {
      sentStatus = code;
      return res;
    }),
    end: vi.fn(() => {
      endCalled = true;
    }),
    json: vi.fn(function (body: unknown) {
      jsonCalled = true;
      sentBody = body;
      return res;
    }),
  } as unknown as Response;

  return {
    res,
    headers,
    get sentStatus() { return sentStatus; },
    get sentBody() { return sentBody; },
    get jsonCalled() { return jsonCalled; },
    get endCalled() { return endCalled; },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generateETag()', () => {
  it('produces a quoted hex string', () => {
    const tag = generateETag('hello world');
    expect(tag).toMatch(/^"[a-f0-9]+"$/);
  });

  it('produces a weak ETag when requested', () => {
    const tag = generateETag('hello world', 'sha256', true);
    expect(tag).toMatch(/^W\/"[a-f0-9]+"$/);
  });

  it('returns the same ETag for the same content', () => {
    const a = generateETag('identical');
    const b = generateETag('identical');
    expect(a).toBe(b);
  });

  it('returns different ETags for different content', () => {
    const a = generateETag('content-a');
    const b = generateETag('content-b');
    expect(a).not.toBe(b);
  });
});

describe('parseIfNoneMatch()', () => {
  it('returns empty array for undefined', () => {
    expect(parseIfNoneMatch(undefined)).toEqual([]);
  });

  it('handles wildcard *', () => {
    expect(parseIfNoneMatch('*')).toEqual(['*']);
  });

  it('parses comma-separated ETags', () => {
    const result = parseIfNoneMatch('"abc", "def", W/"ghi"');
    expect(result).toEqual(['"abc"', '"def"', 'W/"ghi"']);
  });
});

describe('weakMatch()', () => {
  it('matches identical strong ETags', () => {
    expect(weakMatch('"abc"', '"abc"')).toBe(true);
  });

  it('matches strong vs weak ETags with same value', () => {
    expect(weakMatch('"abc"', 'W/"abc"')).toBe(true);
  });

  it('does not match different values', () => {
    expect(weakMatch('"abc"', '"xyz"')).toBe(false);
  });
});

describe('strongMatch()', () => {
  it('matches identical strong ETags', () => {
    expect(strongMatch('"abc"', '"abc"')).toBe(true);
  });

  it('does not match weak ETags', () => {
    expect(strongMatch('W/"abc"', 'W/"abc"')).toBe(false);
  });
});

describe('etag() middleware', () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
    resetETagMetrics();
  });

  it('sets ETag header on GET responses', () => {
    const req = makeReq();
    const { res, headers } = makeRes();
    const mw = etag();

    mw(req, res, next);
    (res.json as ReturnType<typeof vi.fn>)({ data: 'test' });

    expect(headers['ETag']).toBeDefined();
    expect(headers['ETag']).toMatch(/^(W\/)?"[a-f0-9]+"$/);
    expect(next).toHaveBeenCalledOnce();
  });

  it('skips non-GET/HEAD methods', () => {
    const req = makeReq({ method: 'POST' });
    const { res, headers } = makeRes();
    const mw = etag();

    mw(req, res, next);

    expect(headers['ETag']).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 304 when If-None-Match matches', () => {
    const body = { data: 'test-304' };
    const expectedTag = generateETag(JSON.stringify(body));

    const req = makeReq({ headers: { 'if-none-match': expectedTag } });
    const { res, sentStatus, endCalled } = makeRes();
    const mw = etag();

    mw(req, res, next);
    (res.json as ReturnType<typeof vi.fn>)(body);

    expect(sentStatus).toBe(304);
  });

  it('returns full response when If-None-Match does not match', () => {
    const req = makeReq({ headers: { 'if-none-match': '"stale-etag"' } });
    const { res, sentStatus, jsonCalled } = makeRes();
    const mw = etag();

    mw(req, res, next);
    (res.json as ReturnType<typeof vi.fn>)({ data: 'fresh' });

    expect(sentStatus).toBeNull();
    expect(jsonCalled).toBe(true);
  });

  it('handles wildcard * in If-None-Match', () => {
    const req = makeReq({ headers: { 'if-none-match': '*' } });
    const { res, sentStatus } = makeRes();
    const mw = etag();

    mw(req, res, next);
    (res.json as ReturnType<typeof vi.fn>)({ data: 'any' });

    expect(sentStatus).toBe(304);
  });

  it('bypasses authenticated requests when configured', () => {
    const req = makeReq({ headers: { authorization: 'Bearer token' } });
    const { res, headers } = makeRes();
    const mw = etag({ bypassAuthenticated: true });

    mw(req, res, next);

    expect(headers['ETag']).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();

    const m = getETagMetrics();
    expect(m.bypassed).toBe(1);
  });

  it('uses weak ETag for large payloads', () => {
    const req = makeReq();
    const { res, headers } = makeRes();
    const mw = etag({ weakThresholdBytes: 5 });

    mw(req, res, next);
    (res.json as ReturnType<typeof vi.fn>)({ data: 'this is a longer payload' });

    const tag = headers['ETag'] as string;
    expect(tag).toMatch(/^W\//);
  });

  it('tracks metrics correctly', () => {
    resetETagMetrics();

    const mw = etag();
    const body = { count: 1 };
    const tag = generateETag(JSON.stringify(body));

    // First request: generates ETag
    const req1 = makeReq();
    const r1 = makeRes();
    mw(req1, r1.res, vi.fn());
    (r1.res.json as ReturnType<typeof vi.fn>)(body);

    // Second request: matches ETag
    const req2 = makeReq({ headers: { 'if-none-match': tag } });
    const r2 = makeRes();
    mw(req2, r2.res, vi.fn());
    (r2.res.json as ReturnType<typeof vi.fn>)(body);

    const m = getETagMetrics();
    expect(m.generated).toBe(2);
    expect(m.matched).toBe(1);
  });

  it('handles HEAD requests the same as GET', () => {
    const req = makeReq({ method: 'HEAD' });
    const { res, headers } = makeRes();
    const mw = etag();

    mw(req, res, next);
    (res.json as ReturnType<typeof vi.fn>)({ data: 'head' });

    expect(headers['ETag']).toBeDefined();
  });

  it('collision resistance: distinct bodies produce distinct ETags', () => {
    const tags = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tags.add(generateETag(`body-${i}-${Math.random()}`));
    }
    expect(tags.size).toBe(100);
  });
});
