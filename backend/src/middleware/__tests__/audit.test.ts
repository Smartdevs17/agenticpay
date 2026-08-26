import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { auditMiddleware } from '../audit.js';
import { auditService } from '../../services/auditService.js';

vi.mock('../../services/auditService.js', () => {
  return {
    auditService: {
      logAction: vi.fn().mockResolvedValue({ id: 'mock-id' }),
    },
  };
});

describe('auditMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips logAction if the path is in excludePaths', () => {
    const req = {
      path: '/health',
      method: 'GET',
      headers: {},
    } as unknown as Request;

    const res = {
      on: vi.fn(),
    } as unknown as Response;

    const next = vi.fn();
    const middleware = auditMiddleware();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.on).not.toHaveBeenCalled();
  });

  it('hooks into res.on("finish") and logs actions for non-excluded paths', () => {
    const req = {
      path: '/api/v1/payments',
      method: 'POST',
      headers: {
        'user-agent': 'test-agent',
        'x-user-id': 'user-1',
      },
      body: { amount: 100, password: 'secret-password' },
      query: { mode: 'live' },
      params: { id: 'payment-1' },
      ip: '127.0.0.1',
    } as unknown as Request;

    let finishCallback: () => void = () => {};
    const res = {
      statusCode: 201,
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'finish') {
          finishCallback = cb;
        }
      }),
    } as unknown as Response;

    const next = vi.fn();
    const middleware = auditMiddleware();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));

    // Simulate finish event
    finishCallback();

    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'POST /api/v1/payments',
        resource: 'payments',
        resourceId: 'payment-1',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        request: expect.objectContaining({
          method: 'POST',
          path: '/api/v1/payments',
          body: expect.objectContaining({ amount: 100, password: 'secret-password' }),
        }),
        response: expect.objectContaining({
          status: 201,
        }),
      })
    );
  });
});
