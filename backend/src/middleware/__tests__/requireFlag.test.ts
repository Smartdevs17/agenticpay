import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../config/featureFlags.js', () => ({
  featureFlags: { evaluate: vi.fn() },
}));

import { requireFlag } from '../requireFlag.js';
import { featureFlags } from '../config/featureFlags.js';

const mockEvaluate = vi.mocked(featureFlags.evaluate);

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    ip: '192.168.1.1',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
}

describe('requireFlag', () => {
  beforeEach(() => {
    mockEvaluate.mockReset();
  });

  it('calls next() when feature flag is enabled', () => {
    mockEvaluate.mockReturnValue(true);
    const req = makeReq({ headers: { 'x-user-id': 'user_1' } });
    const res = makeRes();
    const next = vi.fn();

    const mw = requireFlag('bulk-verification' as any);
    mw(req, res, next);

    expect(mockEvaluate).toHaveBeenCalledWith('bulk-verification', 'user_1');
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('passes AppError to next() when feature flag is disabled', () => {
    mockEvaluate.mockReturnValue(false);
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    const mw = requireFlag('premium-feature' as any);
    mw(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0] as any;
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FEATURE_DISABLED');
    expect(err.message).toContain('premium-feature');
  });

  it('resolves identifier from x-user-id header first', () => {
    mockEvaluate.mockReturnValue(true);
    const req = makeReq({
      headers: {
        'x-user-id': 'user_456',
        authorization: 'Bearer token',
        'x-api-key': 'key_789',
      },
    });
    const res = makeRes();
    const next = vi.fn();

    const mw = requireFlag('test-flag' as any);
    mw(req, res, next);

    expect(mockEvaluate).toHaveBeenCalledWith('test-flag', 'user_456');
  });

  it('falls back to authorization header when x-user-id is absent', () => {
    mockEvaluate.mockReturnValue(true);
    const req = makeReq({ headers: { authorization: 'Bearer token123' } });
    const res = makeRes();
    const next = vi.fn();

    const mw = requireFlag('test-flag' as any);
    mw(req, res, next);

    expect(mockEvaluate).toHaveBeenCalledWith('test-flag', 'Bearer token123');
  });

  it('falls back to x-api-key header when neither user-id nor auth present', () => {
    mockEvaluate.mockReturnValue(true);
    const req = makeReq({ headers: { 'x-api-key': 'api_key_abc' } });
    const res = makeRes();
    const next = vi.fn();

    const mw = requireFlag('test-flag' as any);
    mw(req, res, next);

    expect(mockEvaluate).toHaveBeenCalledWith('test-flag', 'api_key_abc');
  });

  it('falls back to req.ip when no identifier headers present', () => {
    mockEvaluate.mockReturnValue(true);
    const req = makeReq({ ip: '10.0.0.1' });
    const res = makeRes();
    const next = vi.fn();

    const mw = requireFlag('test-flag' as any);
    mw(req, res, next);

    expect(mockEvaluate).toHaveBeenCalledWith('test-flag', '10.0.0.1');
  });

  it('falls back to anonymous when req.ip is undefined', () => {
    mockEvaluate.mockReturnValue(true);
    const req = makeReq({ ip: undefined });
    const res = makeRes();
    const next = vi.fn();

    const mw = requireFlag('test-flag' as any);
    mw(req, res, next);

    expect(mockEvaluate).toHaveBeenCalledWith('test-flag', 'anonymous');
  });
});
