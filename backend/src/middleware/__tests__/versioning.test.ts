import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { versionMiddleware } from '../versioning.js';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    originalUrl: '/api/health',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): {
  res: Response;
  headers: Record<string, string | string[] | number>;
} {
  const headers: Record<string, string | string[] | number> = {};

  const res = {
    setHeader: vi.fn((name: string, value: string | string[] | number) => {
      headers[name] = value;
    }),
    getHeader: vi.fn((name: string) => headers[name]),
  } as unknown as Response;

  return { res, headers };
}

describe('versionMiddleware()', () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  it('defaults to v1 when no version is provided', () => {
    const req = makeReq();
    const { res, headers } = makeRes();

    versionMiddleware(req, res, next);

    expect(req.apiVersion).toBe('v1');
    expect(headers['X-API-Version']).toBe('v1');
    expect(next).toHaveBeenCalledOnce();
  });

  it('reads version from API-Version header', () => {
    const req = makeReq({ headers: { 'api-version': '1' } });
    const { res, headers } = makeRes();

    versionMiddleware(req, res, next);

    expect(req.apiVersion).toBe('v1');
    expect(headers['X-API-Version']).toBe('v1');
  });

  it('reads version from X-API-Version header', () => {
    const req = makeReq({ headers: { 'x-api-version': 'V1' } });
    const { res, headers } = makeRes();

    versionMiddleware(req, res, next);

    expect(req.apiVersion).toBe('v1');
    expect(headers['X-API-Version']).toBe('v1');
  });

  it('reads version from Accept-Version header', () => {
    const req = makeReq({ headers: { 'accept-version': '1' } });
    const { res, headers } = makeRes();

    versionMiddleware(req, res, next);

    expect(req.apiVersion).toBe('v1');
    expect(headers['X-API-Version']).toBe('v1');
  });

  it('reads version from Content-Type media type versioning', () => {
    const req = makeReq({ headers: { 'content-type': 'application/vnd.agenticpay.v1+json' } });
    const { res, headers } = makeRes();

    versionMiddleware(req, res, next);

    expect(req.apiVersion).toBe('v1');
    expect(headers['X-API-Version']).toBe('v1');
  });

  it('reads version from Content-Type version parameter', () => {
    const req = makeReq({ headers: { 'content-type': 'application/json; version=1' } });
    const { res, headers } = makeRes();

    versionMiddleware(req, res, next);

    expect(req.apiVersion).toBe('v1');
    expect(headers['X-API-Version']).toBe('v1');
  });

  it('parses version from URL when path includes version', () => {
    const req = makeReq({ originalUrl: '/api/v1/health' });
    const { res, headers } = makeRes();

    versionMiddleware(req, res, next);

    expect(req.apiVersion).toBe('v1');
    expect(headers['X-API-Version']).toBe('v1');
  });
});
