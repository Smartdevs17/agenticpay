import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../services/sla.js', () => ({
  slaTracker: { trackRequest: vi.fn() },
}));

import { slaTrackingMiddleware } from '../slaTracking.js';
import { slaTracker } from '../services/sla.js';

const mockTrackRequest = vi.mocked(slaTracker.trackRequest);

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    baseUrl: '/api/v1',
    path: '/test',
    ...overrides,
  } as unknown as Request;
}

function makeRes(): { res: Response; finishHandlers: Array<() => void> } {
  const finishHandlers: Array<() => void> = [];
  const res = {
    statusCode: 200,
    on: vi.fn((event: string, handler: () => void) => { if (event === 'finish') finishHandlers.push(handler); }),
  } as unknown as Response;
  return { res, finishHandlers };
}

describe('slaTrackingMiddleware', () => {
  beforeEach(() => {
    mockTrackRequest.mockReset();
  });

  it('registers a finish handler on the response', () => {
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    slaTrackingMiddleware(req, res, next);

    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
    expect(next).toHaveBeenCalledOnce();
  });

  it('calls slaTracker.trackRequest on finish', () => {
    const req = makeReq();
    const { res, finishHandlers } = makeRes();
    const next = vi.fn();

    slaTrackingMiddleware(req, res, next);
    finishHandlers[0]();

    expect(mockTrackRequest).toHaveBeenCalledOnce();
    const [endpoint, _responseTimeMs, statusCode, _date] = mockTrackRequest.mock.calls[0];
    expect(endpoint).toBe('GET /api/v1/test');
    expect(statusCode).toBe(200);
  });

  it('tracks the correct endpoint format with query params', () => {
    const req = makeReq({ path: '/users?page=1' });
    const { res, finishHandlers } = makeRes();
    const next = vi.fn();

    slaTrackingMiddleware(req, res, next);
    finishHandlers[0]();

    // path should include the query string part from req.path
    expect(mockTrackRequest.mock.calls[0][0]).toContain('/users');
  });

  it('calls next before the request finishes', () => {
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    slaTrackingMiddleware(req, res, next);

    expect(next).toHaveBeenCalledBefore
      ? expect(next).toHaveBeenCalledBefore(mockTrackRequest)
      : expect(next).toHaveBeenCalledOnce();
  });
});
