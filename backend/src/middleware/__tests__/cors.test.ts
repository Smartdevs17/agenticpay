/**
 * cors.test.ts — Unit tests for the CORS middleware backed by the dynamic
 * origin policy: simple requests, preflights, credential handling, open-mode
 * reflection, denials, and live policy mutations.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createCorsMiddleware, DEFAULT_ALLOWED_HEADERS, DEFAULT_METHODS } from '../cors.js';
import { addAllowedOrigin, getCorsMetrics, initCorsPolicy, resetCorsMetrics } from '../../services/cors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ResProbe {
  res: Response;
  headers: Record<string, string | number | string[]>;
  receivedBody: unknown;
  endCalled: boolean;
  jsonCalled: boolean;
  statusCode: number;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    headers: {},
    originalUrl: '/api/v1/test',
    ...overrides,
  } as unknown as Request;
}

function makeRes(): ResProbe {
  const headers: Record<string, string | number | string[]> = {};
  const probe: ResProbe = {
    headers,
    receivedBody: undefined,
    endCalled: false,
    jsonCalled: false,
    statusCode: 200,
    res: {} as Response,
  };
  probe.res = {
    statusCode: 200,
    setHeader: vi.fn((name: string, value: string | number) => {
      headers[name] = value;
    }),
    getHeader: vi.fn((name: string) => headers[name]),
    status: vi.fn(function (code: number) {
      probe.statusCode = code;
      return probe.res;
    }),
    end: vi.fn(() => {
      probe.endCalled = true;
      return probe.res;
    }),
    json: vi.fn(function (body: unknown) {
      probe.jsonCalled = true;
      probe.receivedBody = body;
      return probe.res;
    }),
  } as unknown as Response;
  return probe;
}

function run(
  mw: (req: Request, res: Response, next: NextFunction) => void,
  req: Request,
  res: Response,
): boolean {
  let calledNext = false;
  mw(req, res, () => {
    calledNext = true;
  });
  return calledNext;
}

function header(probe: ResProbe, name: string): string | number | string[] | undefined {
  return probe.headers[name];
}

const ACAO = 'Access-Control-Allow-Origin';

describe('cors middleware', () => {
  beforeEach(() => {
    resetCorsMetrics();
    initCorsPolicy({
      allowedOrigins: [
        'https://app.example.com',
        'https://*.tenant.example.com',
      ],
      allowCredentials: true,
    });
  });

  describe('simple requests', () => {
    it('passes through without CORS headers when no Origin is sent', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware();
      const next = run(mw, makeReq({ headers: {} }), probe.res);

      expect(next).toBe(true);
      expect(probe.endCalled).toBe(false);
      expect(header(probe, ACAO)).toBeUndefined();
      expect(header(probe, 'Vary')).toBe('Origin');
    });

    it('reflects an allowed origin', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware();
      const next = run(
        mw,
        makeReq({ headers: { origin: 'https://app.example.com' } }),
        probe.res,
      );

      expect(next).toBe(true);
      expect(header(probe, ACAO)).toBe('https://app.example.com');
      expect(header(probe, 'Access-Control-Allow-Credentials')).toBe('true');
    });

    it('does NOT set CORS headers for a denied origin but still passes through', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware();
      const next = run(
        mw,
        makeReq({ headers: { origin: 'https://evil.example.org' } }),
        probe.res,
      );

      expect(next).toBe(true);
      expect(header(probe, ACAO)).toBeUndefined();
      expect(header(probe, 'Vary')).toBe('Origin');
    });

    it('exposes extra headers when configured', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware({ exposedHeaders: ['X-Rate-Limit', 'X-Request-Id'] });
      run(mw, makeReq({ headers: { origin: 'https://app.example.com' } }), probe.res);

      expect(header(probe, 'Access-Control-Expose-Headers')).toBe('X-Rate-Limit, X-Request-Id');
    });

    it('supports the wildcard tenant pattern', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware();
      run(
        mw,
        makeReq({ headers: { origin: 'https://team.tenant.example.com' } }),
        probe.res,
      );
      expect(header(probe, ACAO)).toBe('https://team.tenant.example.com');
    });

    it('does not set CORS headers for non-Origin-less POST mutations', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware();
      const next = run(
        mw,
        makeReq({ method: 'POST', headers: { origin: 'https://evil.example.org' } }),
        probe.res,
      );
      expect(next).toBe(true);
      expect(header(probe, ACAO)).toBeUndefined();
    });
  });

  describe('open mode and wildcard', () => {
    it('open mode without credentials emits a bare "*"', () => {
      resetCorsMetrics();
      initCorsPolicy({ allowedOrigins: ['*'], allowCredentials: false });
      const probe = makeRes();
      const mw = createCorsMiddleware();
      run(mw, makeReq({ headers: { origin: 'https://anything.example.com' } }), probe.res);

      expect(header(probe, ACAO)).toBe('*');
      expect(header(probe, 'Access-Control-Allow-Credentials')).toBeUndefined();
      expect(header(probe, 'Access-Control-Expose-Headers')).toBeUndefined();
    });

    it('open mode WITH credentials reflects the concrete origin', () => {
      resetCorsMetrics();
      initCorsPolicy({ allowedOrigins: ['*'], allowCredentials: true });
      const probe = makeRes();
      const mw = createCorsMiddleware();
      run(mw, makeReq({ headers: { origin: 'https://app.example.com' } }), probe.res);

      expect(header(probe, ACAO)).toBe('https://app.example.com');
      expect(header(probe, 'Access-Control-Allow-Credentials')).toBe('true');
    });
  });

  describe('dynamic whitelisting', () => {
    it('honours origins added to the policy AFTER the middleware was created', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware({ credentials: false });
      run(mw, makeReq({ headers: { origin: 'https://new.example.com' } }), probe.res);
      expect(header(probe, ACAO)).toBeUndefined();

      addAllowedOrigin('https://new.example.com');

      const probe2 = makeRes();
      run(mw, makeReq({ headers: { origin: 'https://new.example.com' } }), probe2.res);
      expect(header(probe2, ACAO)).toBe('https://new.example.com');
    });

    it('seeds the shared policy when allowedOrigins is passed to the factory', () => {
      resetCorsMetrics();
      initCorsPolicy({ allowedOrigins: ['https://stale.example.com'] });
      createCorsMiddleware({ allowedOrigins: ['https://fresh.example.com'] });

      const probe = makeRes();
      const mw = createCorsMiddleware();
      run(mw, makeReq({ headers: { origin: 'https://fresh.example.com' } }), probe.res);
      expect(header(probe, ACAO)).toBe('https://fresh.example.com');
    });
  });

  describe('preflight requests', () => {
    const preflight = (origin = 'https://app.example.com') =>
      makeReq({
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,authorization',
        },
      });

    it('answers an allowed preflight with 204 and negotiated headers', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware({ credentials: true, maxAge: 600 });
      const next = run(mw, preflight(), probe.res);

      expect(next).toBe(false);
      expect(probe.endCalled).toBe(true);
      expect(probe.statusCode).toBe(204);
      expect(header(probe, ACAO)).toBe('https://app.example.com');
      expect(header(probe, 'Access-Control-Allow-Credentials')).toBe('true');
      expect(header(probe, 'Access-Control-Allow-Methods')).toBe('POST');
      expect(header(probe, 'Access-Control-Allow-Headers')).toBe('content-type, authorization');
      expect(header(probe, 'Access-Control-Max-Age')).toBe('600');
      expect(header(probe, 'Vary')).toContain('Origin');
      expect(header(probe, 'Vary')).toContain('Access-Control-Request-Method');
      expect(header(probe, 'Vary')).toContain('Access-Control-Request-Headers');
    });

    it('answers a denied preflight with 204 but no allow headers', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware();
      const next = run(mw, preflight('https://evil.example.org'), probe.res);

      expect(next).toBe(false);
      expect(probe.endCalled).toBe(true);
      expect(header(probe, ACAO)).toBeUndefined();
      expect(header(probe, 'Access-Control-Allow-Methods')).toBeUndefined();
      expect(getCorsMetrics().preflightDenied).toBe(1);
    });

    it('omits Allow-Methods when the requested method is not configured', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware({ methods: ['GET', 'OPTIONS'] });
      run(mw, preflight(), probe.res);

      expect(header(probe, 'Access-Control-Allow-Methods')).toBeUndefined();
      expect(header(probe, ACAO)).toBeTruthy();
    });

    it('filters requested headers against the configured allow list', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware({ allowedHeaders: ['Authorization'] });
      run(mw, preflight(), probe.res);

      expect(header(probe, 'Access-Control-Allow-Headers')).toBe('authorization');
    });

    it('emits Access-Control-Allow-Private-Network on PNA preflights', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware();
      const req = preflight();
      req.headers['access-control-request-private-network'] = 'true';
      run(mw, req, probe.res);

      expect(header(probe, 'Access-Control-Allow-Private-Network')).toBe('true');
    });

    it('hands the preflight to the app when preflightContinue is set', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware({ preflightContinue: true });
      const next = run(mw, preflight(), probe.res);

      expect(next).toBe(true);
      expect(probe.endCalled).toBe(false);
      expect(header(probe, ACAO)).toBe('https://app.example.com');
    });

    it('treats a plain OPTIONS (no request-method) as a simple request', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware();
      const next = run(
        mw,
        makeReq({ method: 'OPTIONS', headers: { origin: 'https://app.example.com' } }),
        probe.res,
      );

      expect(next).toBe(true);
      expect(probe.endCalled).toBe(false);
      expect(header(probe, ACAO)).toBe('https://app.example.com');
      expect(header(probe, 'Access-Control-Allow-Methods')).toBeUndefined();
    });
  });

  describe('metrics and edge input', () => {
    it('counts allowed and denied simple requests', () => {
      const mw = createCorsMiddleware();
      run(mw, makeReq({ headers: { origin: 'https://app.example.com' } }), makeRes().res);
      run(mw, makeReq({ headers: { origin: 'https://app.example.com' } }), makeRes().res);
      run(mw, makeReq({ headers: { origin: 'https://evil.example.org' } }), makeRes().res);

      const m = getCorsMetrics();
      expect(m.allowedRequests).toBe(2);
      expect(m.deniedRequests).toBe(1);
      expect(m.preflights).toBe(0);
    });

    it('uses the first origin from a space-separated Origin list', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware();
      const multiple = makeReq({
        headers: { origin: 'https://app.example.com https://sandbox.example.com' },
      });
      const next = run(mw, multiple, probe.res);

      expect(next).toBe(true);
      expect(header(probe, ACAO)).toBe('https://app.example.com');
    });

    it('denies the null origin without CORS headers', () => {
      const probe = makeRes();
      const mw = createCorsMiddleware();
      const next = run(mw, makeReq({ headers: { origin: 'null' } }), probe.res);

      expect(next).toBe(true);
      expect(header(probe, ACAO)).toBeUndefined();
      expect(getCorsMetrics().deniedRequests).toBe(1);
    });
  });

  describe('exported defaults', () => {
    it('exposes sane default method/header lists', () => {
      expect(DEFAULT_METHODS).toContain('GET');
      expect(DEFAULT_METHODS).toContain('OPTIONS');
      expect(DEFAULT_ALLOWED_HEADERS).toEqual(['Content-Type', 'Authorization']);
    });
  });
});