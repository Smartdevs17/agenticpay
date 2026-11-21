import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../services/session.js', () => ({
  updateSessionActivity: vi.fn(),
  getSession: vi.fn(),
  checkSessionAnomaly: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { sessionMiddleware } from '../session.js';
import { getSession, updateSessionActivity, checkSessionAnomaly } from '../services/session.js';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' } as any,
    ...overrides,
  } as unknown as Request;
}

function makeRes(): { res: Response; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: vi.fn((name: string, value: string) => { headers[name] = value; }),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { res, headers };
}

describe('sessionMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls next() when no session header is present', () => {
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    sessionMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(getSession).not.toHaveBeenCalled();
  });

  it('calls next() when session id is present but session not found', () => {
    vi.mocked(getSession).mockReturnValue(null);
    const req = makeReq({ headers: { 'x-session-id': 'sess_123' } });
    const { res } = makeRes();
    const next = vi.fn();

    sessionMiddleware(req, res, next);

    expect(getSession).toHaveBeenCalledWith('sess_123');
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 401 with AppError when session is terminated', () => {
    vi.mocked(getSession).mockReturnValue({ status: 'terminated', userId: 'user_1' } as any);
    const req = makeReq({ headers: { 'x-session-id': 'sess_terminated' } });
    const { res } = makeRes();
    const next = vi.fn();

    sessionMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0] as any;
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('SESSION_TERMINATED');
  });

  it('updates session activity for active sessions', () => {
    vi.mocked(getSession).mockReturnValue({ status: 'active', userId: 'user_1' } as any);
    vi.mocked(checkSessionAnomaly).mockReturnValue(null);
    const req = makeReq({ headers: { 'x-session-id': 'sess_active' } });
    const { res } = makeRes();
    const next = vi.fn();

    sessionMiddleware(req, res, next);

    expect(updateSessionActivity).toHaveBeenCalledWith('sess_active', '127.0.0.1');
    expect(next).toHaveBeenCalledOnce();
  });

  it('sets warning header when anomaly detected', () => {
    vi.mocked(getSession).mockReturnValue({ status: 'active', userId: 'user_1' } as any);
    vi.mocked(checkSessionAnomaly).mockReturnValue('IP mismatch');
    const req = makeReq({ headers: { 'x-session-id': 'sess_anomaly' } });
    const { res, headers } = makeRes();
    const next = vi.fn();

    sessionMiddleware(req, res, next);

    expect(headers['X-Session-Warning']).toBe('IP mismatch');
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses x-forwarded-for header for IP when available', () => {
    vi.mocked(getSession).mockReturnValue({ status: 'active', userId: 'user_1' } as any);
    vi.mocked(checkSessionAnomaly).mockReturnValue(null);
    const req = makeReq({
      headers: { 'x-session-id': 'sess_proxy', 'x-forwarded-for': '203.0.113.1' },
    });
    const { res } = makeRes();
    const next = vi.fn();

    sessionMiddleware(req, res, next);

    expect(updateSessionActivity).toHaveBeenCalledWith('sess_proxy', '203.0.113.1');
  });
});
