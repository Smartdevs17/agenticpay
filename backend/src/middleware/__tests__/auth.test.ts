/**
 * auth.test.ts — Issue #721
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  createAuthMiddleware,
  sessionStrategy,
  apiKeyStrategy,
  type AuthStrategy,
} from '../auth.js';
import { createSession } from '../../services/session.js';
import { AppError } from '../errorHandler.js';

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function makeRes(): Response {
  return {} as Response;
}

describe('sessionStrategy', () => {
  it('resolves a principal from a valid session', async () => {
    const session = createSession('user-1', { deviceId: 'd1', browser: 'chrome', os: 'mac', ip: '127.0.0.1' });
    const req = makeReq({ 'x-session-id': session.id });

    expect(sessionStrategy.applies(req)).toBe(true);
    const principal = await sessionStrategy.authenticate(req, makeRes());
    expect(principal).toMatchObject({ id: 'user-1', method: 'session' });
  });

  it('rejects an unknown session id', async () => {
    const req = makeReq({ 'x-session-id': 'does-not-exist' });
    await expect(sessionStrategy.authenticate(req, makeRes())).rejects.toBeInstanceOf(AppError);
  });

  it('does not apply when no session header is present', () => {
    expect(sessionStrategy.applies(makeReq())).toBe(false);
  });
});

describe('apiKeyStrategy', () => {
  it('resolves a principal for a known demo key', async () => {
    const req = makeReq({ 'x-api-key': 'apk_free_demo_key_00000000000000000000000001' });
    expect(apiKeyStrategy.applies(req)).toBe(true);
    const principal = await apiKeyStrategy.authenticate(req, makeRes());
    expect(principal).toMatchObject({ role: 'free', method: 'apiKey' });
  });

  it('rejects an unknown api key', async () => {
    const req = makeReq({ 'x-api-key': 'not-a-real-key' });
    await expect(apiKeyStrategy.authenticate(req, makeRes())).rejects.toBeInstanceOf(AppError);
  });
});

describe('createAuthMiddleware (orchestration)', () => {
  function makeStrategy(name: 'session' | 'apiKey', opts: { applies: boolean; succeed?: boolean }): AuthStrategy {
    return {
      name,
      applies: () => opts.applies,
      authenticate: vi.fn(async (req) => {
        if (!opts.succeed) throw new AppError(401, `${name} failed`, 'FAIL');
        req.user = { id: 'x', tenantId: 't', role: 'user', method: name };
        return req.user;
      }),
    };
  }

  it('responds 401 when no strategy applies', async () => {
    const middleware = createAuthMiddleware([makeStrategy('session', { applies: false })]);
    const req = makeReq();
    const next = vi.fn();

    await middleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(401);
  });

  it('authenticates with the first applicable strategy that succeeds', async () => {
    const failing = makeStrategy('session', { applies: true, succeed: false });
    const succeeding = makeStrategy('apiKey', { applies: true, succeed: true });
    const middleware = createAuthMiddleware([failing, succeeding]);
    const req = makeReq();
    const next = vi.fn();

    await middleware(req, makeRes(), next);

    expect(req.user).toMatchObject({ method: 'apiKey' });
    expect(next).toHaveBeenCalledWith();
  });

  it('propagates the last strategy failure when every applicable strategy fails', async () => {
    const first = makeStrategy('session', { applies: true, succeed: false });
    const second = makeStrategy('apiKey', { applies: true, succeed: false });
    const middleware = createAuthMiddleware([first, second]);
    const req = makeReq();
    const next = vi.fn();

    await middleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect(req.user).toBeUndefined();
  });
});
