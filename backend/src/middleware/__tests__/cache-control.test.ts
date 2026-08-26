import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { cacheControlNoStore, CACHE_NOSTORE_HEADER, VARY_HEADER } from '../cache-control.js';

function makeReq(overrides: Partial<Request> = {}): Request {
  return { method: 'GET', ...overrides } as unknown as Request;
}

function makeRes(): { res: Response; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: vi.fn((name: string, value: string) => { headers[name] = value; }),
  } as unknown as Response;
  return { res, headers };
}

describe('cacheControlNoStore', () => {
  it('sets Cache-Control: no-store for POST requests', () => {
    const req = makeReq({ method: 'POST' });
    const { res, headers } = makeRes();
    const next = vi.fn();

    cacheControlNoStore(req, res, next);

    expect(headers[CACHE_NOSTORE_HEADER]).toBe('no-store');
    expect(next).toHaveBeenCalledOnce();
  });

  it('sets Cache-Control: no-store for PUT requests', () => {
    const req = makeReq({ method: 'PUT' });
    const { res, headers } = makeRes();
    const next = vi.fn();

    cacheControlNoStore(req, res, next);

    expect(headers[CACHE_NOSTORE_HEADER]).toBe('no-store');
  });

  it('sets Cache-Control: no-store for DELETE requests', () => {
    const req = makeReq({ method: 'DELETE' });
    const { res, headers } = makeRes();
    const next = vi.fn();

    cacheControlNoStore(req, res, next);

    expect(headers[CACHE_NOSTORE_HEADER]).toBe('no-store');
  });

  it('does NOT set Cache-Control: no-store for GET requests', () => {
    const req = makeReq({ method: 'GET' });
    const { res, headers } = makeRes();
    const next = vi.fn();

    cacheControlNoStore(req, res, next);

    expect(headers[CACHE_NOSTORE_HEADER]).toBeUndefined();
  });

  it('does NOT set Cache-Control: no-store for HEAD requests', () => {
    const req = makeReq({ method: 'HEAD' });
    const { res, headers } = makeRes();
    const next = vi.fn();

    cacheControlNoStore(req, res, next);

    expect(headers[CACHE_NOSTORE_HEADER]).toBeUndefined();
  });

  it('always sets Vary: Accept-Encoding header', () => {
    const req = makeReq({ method: 'GET' });
    const { res, headers } = makeRes();
    const next = vi.fn();

    cacheControlNoStore(req, res, next);

    expect(headers[VARY_HEADER]).toBe('Accept-Encoding');
  });

  it('sets both headers for mutations', () => {
    const req = makeReq({ method: 'PATCH' });
    const { res, headers } = makeRes();
    const next = vi.fn();

    cacheControlNoStore(req, res, next);

    expect(headers[CACHE_NOSTORE_HEADER]).toBe('no-store');
    expect(headers[VARY_HEADER]).toBe('Accept-Encoding');
  });

  it('calls next()', () => {
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    cacheControlNoStore(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
