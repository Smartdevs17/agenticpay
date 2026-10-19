import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { idempotency, clearIdempotencyCache, getIdempotencyCacheStats } from '../idempotency.js';

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

describe('idempotency middleware payload fingerprinting', () => {
  beforeEach(() => {
    clearIdempotencyCache();
  });

  /** Runs one request through the middleware and returns the mocked response plus `next`. */
  function send(key: string, body: unknown) {
    const req = makeReq({ method: 'POST', headers: { 'idempotency-key': key }, body });
    const { res } = makeRes();
    const next = vi.fn();
    idempotency()(req, res, next);
    return { res, next };
  }

  function respond(res: Response, statusCode: number, body: unknown) {
    res.statusCode = statusCode;
    (res.json as ReturnType<typeof vi.fn>)(body);
  }

  it('rejects reuse of a key with a different payload', () => {
    respond(send('key-x', { amount: 100 }).res, 201, { id: 'payment_1' });

    const second = send('key-x', { amount: 999 });

    expect(second.res.status).toHaveBeenCalledWith(409);
    expect(second.res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'idempotency_key_reuse_mismatch' }),
    );
    expect(second.next).not.toHaveBeenCalled();
  });

  it('replays the cached response when the payload matches', () => {
    respond(send('key-y', { amount: 100 }).res, 201, { id: 'payment_1' });

    const second = send('key-y', { amount: 100 });

    expect(second.res.status).toHaveBeenCalledWith(201);
    expect(second.res.json).toHaveBeenCalledWith({ id: 'payment_1' });
    expect(second.next).not.toHaveBeenCalled();
  });

  it('treats a differently ordered payload as the same request', () => {
    respond(send('key-z', { amount: 100, currency: 'USD' }).res, 200, { id: 'payment_1' });

    const second = send('key-z', { currency: 'USD', amount: 100 });

    expect(second.res.status).toHaveBeenCalledWith(200);
    expect(second.next).not.toHaveBeenCalled();
  });

  it('detects a changed nested field', () => {
    respond(send('key-n', { meta: { tags: ['a'] } }).res, 200, { id: 'payment_1' });

    const second = send('key-n', { meta: { tags: ['b'] } });

    expect(second.res.status).toHaveBeenCalledWith(409);
  });
});

describe('idempotency middleware cache bounds', () => {
  beforeEach(() => {
    clearIdempotencyCache();
  });

  it('evicts the oldest entries once the limit is reached', () => {
    const mw = idempotency(60_000, 2);

    for (const key of ['a', 'b', 'c']) {
      const req = makeReq({ headers: { 'idempotency-key': key } });
      const { res } = makeRes();
      mw(req, res, vi.fn());
      res.statusCode = 200;
      (res.json as ReturnType<typeof vi.fn>)({ key });
    }

    expect(getIdempotencyCacheStats().cachedKeys).toBe(2);

    // The oldest entry was evicted, so it executes again instead of replaying.
    const req = makeReq({ headers: { 'idempotency-key': 'a' } });
    const { res } = makeRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
