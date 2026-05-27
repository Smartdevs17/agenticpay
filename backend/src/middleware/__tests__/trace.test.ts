import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { traceMiddleware, getTraceId, traceStorage, TRACE_ID_HEADER } from '../trace.js';

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

describe('traceMiddleware', () => {
  it('generates a trace ID when no x-trace-id header is present', () => {
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    traceMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Trace-Id', expect.any(String));
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses existing x-trace-id header when present', () => {
    const existingTraceId = 'trace-abc-123';
    const req = makeReq({ headers: { 'x-trace-id': existingTraceId } });
    const { res } = makeRes();
    const next = vi.fn();

    traceMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Trace-Id', existingTraceId);
  });

  it('runs next() within AsyncLocalStorage context', () => {
    const req = makeReq({ headers: { 'x-trace-id': 'test-trace' } });
    const { res } = makeRes();
    let capturedTraceId: string | undefined;

    const next = vi.fn(() => {
      capturedTraceId = getTraceId();
    });

    traceMiddleware(req, res, next);

    expect(capturedTraceId).toBe('test-trace');
  });

  it('sets X-Trace-Id response header', () => {
    const req = makeReq();
    const { res, headers } = makeRes();
    const next = vi.fn();

    traceMiddleware(req, res, next);

    expect(headers['X-Trace-Id']).toBeDefined();
  });

  it('getTraceId returns undefined outside of a trace context', () => {
    const traceId = getTraceId();
    expect(traceId).toBeUndefined();
  });
});
