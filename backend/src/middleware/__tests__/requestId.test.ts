import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requestIdMiddleware, REQUEST_ID_HEADER } from '../requestId.js';

function makeReq(overrides: Partial<Request> = {}): Request {
  return { method: 'GET', headers: {}, ...overrides } as unknown as Request;
}

function makeRes(): { res: Response; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: vi.fn((name: string, value: string) => { headers[name] = value; }),
  } as unknown as Response;
  return { res, headers };
}

describe('requestIdMiddleware', () => {
  it('generates a UUID when no x-request-id header is present', () => {
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.requestId);
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses existing x-request-id header when present', () => {
    const existingId = 'existing-id-12345';
    const req = makeReq({ headers: { 'x-request-id': existingId } });
    const { res } = makeRes();
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toBe(existingId);
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, existingId);
  });

  it('sets the X-Request-Id response header', () => {
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, expect.any(String));
  });

  it('calls next()', () => {
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
