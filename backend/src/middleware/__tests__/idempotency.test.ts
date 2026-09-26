import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { idempotency, clearIdempotencyCache } from '../idempotency.js';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    originalUrl: '/api/v1/payments',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): {
  res: Response;
  statusCode: number;
  sentBody: unknown;
  jsonCalled: boolean;
} {
  let statusCode = 200;
  let sentBody: unknown = undefined;
  let jsonCalled = false;

  const res = {
    statusCode,
    status: vi.fn(function (code: number) {
      statusCode = code;
      return res;
    }),
    json: vi.fn(function (body: unknown) {
      jsonCalled = true;
      sentBody = body;
      return res;
    }),
    get statusCode() { return statusCode; },
    set statusCode(v: number) { statusCode = v; },
  } as unknown as Response;

  return {
    res,
    get statusCode() { return statusCode; },
    get sentBody() { return sentBody; },
    get jsonCalled() { return jsonCalled; },
  };
}

describe('idempotency middleware', () => {
  beforeEach(() => {
    clearIdempotencyCache();
  });

  it('calls next() when no x-idempotency-key header is present', () => {
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    const mw = idempotency();
    mw(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('intercepts res.json to cache the response', () => {
    const req = makeReq({ headers: { 'x-idempotency-key': 'key-123' } });
    const { res } = makeRes();
    const next = vi.fn();

    const mw = idempotency();
    mw(req, res, next);

    const originalJson = res.json;
    expect(res.json).not.toBe(originalJson);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns cached response on subsequent identical request', () => {
    const req1 = makeReq({ headers: { 'x-idempotency-key': 'key-456' } });
    const { res: res1 } = makeRes();
    const next1 = vi.fn();

    const mw = idempotency();
    mw(req1, res1, next1);
    res1.statusCode = 201;
    (res1.json as ReturnType<typeof vi.fn>)({ id: 'payment_1', status: 'succeeded' });

    const req2 = makeReq({ headers: { 'x-idempotency-key': 'key-456' } });
    const { res: res2 } = makeRes();
    const next2 = vi.fn();

    mw(req2, res2, next2);

    expect(res2.status).toHaveBeenCalledWith(201);
    expect(res2.json).toHaveBeenCalledWith({ id: 'payment_1', status: 'succeeded' });
    expect(next2).not.toHaveBeenCalled();
  });

  it('uses different caches for different idempotency keys', () => {
    const mw = idempotency();

    const req1 = makeReq({ headers: { 'x-idempotency-key': 'key-a' } });
    const { res: res1 } = makeRes();
    mw(req1, res1, vi.fn());
    res1.statusCode = 200;
    (res1.json as ReturnType<typeof vi.fn>)({ result: 'a' });

    const req2 = makeReq({ headers: { 'x-idempotency-key': 'key-b' } });
    const { res: res2 } = makeRes();
    const next2 = vi.fn();

    mw(req2, res2, next2);

    expect(next2).toHaveBeenCalledOnce();
    const originalJson = res2.json;
    expect(res2.json).not.toBe(originalJson);
  });

  it('uses different caches for different routes with same key', () => {
    const mw = idempotency();

    const req1 = makeReq({ originalUrl: '/api/v1/payments', headers: { 'x-idempotency-key': 'key-same' } });
    const { res: res1 } = makeRes();
    mw(req1, res1, vi.fn());
    res1.statusCode = 200;
    (res1.json as ReturnType<typeof vi.fn>)({ route: 'payments' });

    const req2 = makeReq({ originalUrl: '/api/v1/refunds', headers: { 'x-idempotency-key': 'key-same' } });
    const { res: res2 } = makeRes();
    const next2 = vi.fn();

    mw(req2, res2, next2);

    expect(next2).toHaveBeenCalledOnce();
  });

  it('expires cached entries after TTL', async () => {
    const mw = idempotency(10);

    const req1 = makeReq({ headers: { 'x-idempotency-key': 'key-expire' } });
    const { res: res1 } = makeRes();
    mw(req1, res1, vi.fn());
    res1.statusCode = 200;
    (res1.json as ReturnType<typeof vi.fn>)({ data: 'fresh' });

    await new Promise((r) => setTimeout(r, 20));

    const req2 = makeReq({ headers: { 'x-idempotency-key': 'key-expire' } });
    const { res: res2 } = makeRes();
    const next2 = vi.fn();

    mw(req2, res2, next2);

    expect(next2).toHaveBeenCalledOnce();
  });
});
