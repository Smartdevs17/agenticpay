/**
 * Sensitive-operation audit middleware tests — Issue #793
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  auditSensitiveOperations,
  classifySensitivePath,
  isSensitiveOperation,
  sensitiveAuditMiddleware,
} from '../sensitiveAudit.js';
import { auditService } from '../../services/auditService.js';

vi.mock('../../services/auditService.js', () => ({
  auditService: {
    logAction: vi.fn().mockResolvedValue({ id: 'mock-id' }),
  },
}));

interface MockResponse {
  statusCode: number;
  writableFinished?: boolean;
  on: (event: string, cb: () => void) => MockResponse;
}

function makeRes(overrides: Partial<MockResponse> = {}) {
  const listeners: Record<string, () => void> = {};
  const res: MockResponse = {
    statusCode: 200,
    writableFinished: true,
    on: vi.fn((event: string, cb: () => void) => {
      listeners[event] = cb;
      return res;
    }),
    ...overrides,
  };
  return { res: res as unknown as Response, listeners };
}

function makeReq(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    method: 'POST',
    path: '/api/v1/auth/login',
    headers: { 'user-agent': 'vitest', 'x-user-id': 'user-42' },
    body: { password: 'super-secret' },
    params: {},
    query: {},
    ip: '203.0.113.7',
    socket: { remoteAddress: '203.0.113.7' },
    ...overrides,
  } as unknown as Request;
}

describe('sensitive path classification', () => {
  it('classifies auth, payments, admin, identity, and compliance paths', () => {
    expect(classifySensitivePath('/api/v1/auth/login')).toBe('auth');
    expect(classifySensitivePath('/api/v1/payments/123')).toBe('payments');
    expect(classifySensitivePath('/api/v1/admin/users')).toBe('admin');
    expect(classifySensitivePath('/api/v1/kyb/status')).toBe('identity');
    expect(classifySensitivePath('/api/v1/compliance/report')).toBe('compliance');
  });

  it('ignores non-sensitive paths', () => {
    expect(classifySensitivePath('/api/v1/health')).toBeUndefined();
    expect(isSensitiveOperation('/api/v1/catalog/items')).toBe(false);
    expect(isSensitiveOperation('/api/v1/payments')).toBe(true);
  });
});

describe('sensitiveAuditMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not log non-sensitive requests', () => {
    const { res } = makeRes();
    const next = vi.fn();

    sensitiveAuditMiddleware()(makeReq({ path: '/api/v1/catalog/items' }), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.on).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it('records timestamp, user, action, IP, and a success outcome on finish', () => {
    const { res, listeners } = makeRes({ statusCode: 201 });
    const next = vi.fn();

    sensitiveAuditMiddleware()(makeReq(), res, next);
    expect(next).toHaveBeenCalledOnce();

    listeners.finish();

    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-42',
        action: 'auth.post',
        resource: 'auth',
        outcome: 'success',
        ipAddress: '203.0.113.7',
        response: { status: 201 },
      }),
    );
  });

  it('marks 4xx/5xx responses as failures', () => {
    const { res, listeners } = makeRes({ statusCode: 401 });

    sensitiveAuditMiddleware()(makeReq({ path: '/api/v1/payments/transfer' }), res, vi.fn());
    listeners.finish();

    const call = vi.mocked(auditService.logAction).mock.calls[0][0];
    expect(call.outcome).toBe('failure');
    expect(call.resource).toBe('payments');
  });

  it('treats aborted connections as failures', () => {
    const { res, listeners } = makeRes({ writableFinished: false });

    sensitiveAuditMiddleware()(makeReq({ path: '/api/v1/admin/flags' }), res, vi.fn());
    listeners.close();

    expect(vi.mocked(auditService.logAction).mock.calls[0][0].outcome).toBe('failure');
  });

  it('skips explicitly excluded paths', () => {
    const { res } = makeRes();
    sensitiveAuditMiddleware({ excludePaths: ['/api/v1/auth/refresh'] })(
      makeReq({ path: '/api/v1/auth/refresh' }),
      res,
      vi.fn(),
    );

    expect(res.on).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it('supports custom action and user mappers', () => {
    const { res, listeners } = makeRes();
    sensitiveAuditMiddleware({
      actionMapper: (req, category) => `${category}:${req.method}`,
      userIdResolver: () => 'custom-user',
    })(makeReq({ path: '/api/v1/admin/flags' }), res, vi.fn());
    listeners.finish();

    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'custom-user', action: 'admin:POST' }),
    );
  });

  it('exports a default middleware alias', () => {
    expect(auditSensitiveOperations).toBe(sensitiveAuditMiddleware);
  });
});
