import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { payoutSecurityMiddleware, DEFAULT_SECURITY_CONFIG } from '../payout-security.js';

function makeRequest(body: unknown): Request {
  return {
    body,
    headers: {},
    socket: { remoteAddress: '203.0.113.10' },
  } as unknown as Request;
}

function makeResponse() {
  let statusCode = 200;
  let responseBody: unknown;
  const res = {
    status: vi.fn((code: number) => { statusCode = code; return res; }),
    json: vi.fn((body: unknown) => { responseBody = body; return res; }),
  } as unknown as Response;
  return { res, get statusCode() { return statusCode; }, get responseBody() { return responseBody; } };
}

describe('payout security input validation', () => {
  const middleware = payoutSecurityMiddleware({
    ...DEFAULT_SECURITY_CONFIG,
    enableGeoChecks: false,
    enableVelocityChecks: false,
  });

  it.each([
    [{ merchantId: 'merchant-a', amount: -1 }],
    [{ merchantId: 'merchant-a', amount: 0 }],
    [{ merchantId: 'merchant-a', amount: 'NaN' }],
    [{ merchantId: 'merchant-a', amount: Infinity }],
    [{ merchantId: '', amount: 1 }],
    [{ merchantId: 'x'.repeat(129), amount: 1 }],
    [{ merchantId: 'merchant-a', amount: 1_000_001 }],
    [null],
  ])('rejects malformed payout input before continuing', async (body) => {
    const req = makeRequest(body);
    const { res } = makeResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'INVALID_PAYOUT_REQUEST' }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('allows valid payout input to continue', async () => {
    const req = makeRequest({ merchantId: 'merchant-valid', amount: 10 });
    const { res } = makeResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
