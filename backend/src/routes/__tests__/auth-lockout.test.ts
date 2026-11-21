/**
 * Auth Lockout Route Tests — Issue #805
 *
 * Tests the LockoutManager directly (in-memory, no external mocks needed)
 * and tests the HTTP endpoints via a real Express server.
 */

import express, { type Express } from 'express';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { AddressInfo } from 'node:net';

// Mock auditService before any other imports that might trigger it
vi.mock('../../services/auditService.js', () => ({
  auditService: {
    logAction: vi.fn().mockResolvedValue({}),
  },
}));

import { authLockoutRouter } from '../auth-lockout.js';
import { LockoutManager } from '../../services/auth/lockout-manager.js';
import type { Request, Response, NextFunction } from 'express';

// Custom error handler that avoids module-instance instanceof checks.
// Checks err.name === 'AppError' to handle the case where vitest loads
// the compiled errorHandler.js as a separate CJS module instance.
function testErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const isAppError =
    err !== null &&
    typeof err === 'object' &&
    (err as Record<string, unknown>).name === 'AppError';
  const statusCode = isAppError
    ? (err as Record<string, unknown>).statusCode as number
    : 500;
  const code = isAppError
    ? (err as Record<string, unknown>).code as string
    : 'INTERNAL_SERVER_ERROR';
  const message = isAppError
    ? (err as Error).message
    : err instanceof Error
      ? err.message
      : 'Unexpected error';
  res.status(statusCode).json({ error: { code, message, status: statusCode } });
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

let server: import('node:http').Server;
let base = '';

async function call<T = unknown>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as T) : (undefined as T),
  };
}

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use('/auth/lockout', authLockoutRouter);
  app.use(testErrorHandler);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// ---------------------------------------------------------------------------
// LockoutManager unit tests (in-memory, direct)
// ---------------------------------------------------------------------------

describe('LockoutManager (unit)', () => {
  // Use a fresh manager per describe block so state doesn't leak
  let manager: LockoutManager;

  beforeEach(() => {
    manager = new LockoutManager();
  });

  it('recordAttempt with success=true clears lockout state', async () => {
    // Build up some failures first
    await manager.recordAttempt({
      accountId: 'user1',
      ipAddress: '1.2.3.4',
      success: false,
    });
    await manager.recordAttempt({
      accountId: 'user1',
      ipAddress: '1.2.3.4',
      success: false,
    });

    // Successful login clears state
    const result = await manager.recordAttempt({
      accountId: 'user1',
      ipAddress: '1.2.3.4',
      success: true,
    });
    expect(result).toEqual({});

    const status = manager.getStatus('user1', '1.2.3.4');
    expect(status.locked).toBe(false);
    expect(status.failedAttempts).toBe(0);
  });

  it('recordAttempt with success=false increments failed counter', async () => {
    await manager.recordAttempt({
      accountId: 'user2',
      ipAddress: '1.2.3.5',
      success: false,
    });
    const status = manager.getStatus('user2', '1.2.3.5');
    expect(status.failedAttempts).toBe(1);
    expect(status.locked).toBe(false);
  });

  it('account gets locked after maxAttempts (10) failures', async () => {
    const accountId = 'user3';
    const ipAddress = '1.2.3.6';
    let lastResult: { lockedUntil?: number; unlockToken?: string } = {};

    for (let i = 0; i < 10; i++) {
      lastResult = await manager.recordAttempt({ accountId, ipAddress, success: false });
    }

    // lockedUntil should be set after the 10th failure
    expect(lastResult.lockedUntil).toBeDefined();
    expect(lastResult.lockedUntil).toBeGreaterThan(Date.now());
    expect(lastResult.unlockToken).toBeDefined();

    const status = manager.getStatus(accountId, ipAddress);
    expect(status.locked).toBe(true);
    expect(status.lockedUntil).toBeDefined();
  });

  it('getStatus shows correct locked state', async () => {
    const accountId = 'user4';
    const ipAddress = '1.2.3.7';

    // Not locked initially
    const initial = manager.getStatus(accountId, ipAddress);
    expect(initial.locked).toBe(false);
    expect(initial.failedAttempts).toBe(0);

    // Lock it
    for (let i = 0; i < 10; i++) {
      await manager.recordAttempt({ accountId, ipAddress, success: false });
    }

    const locked = manager.getStatus(accountId, ipAddress);
    expect(locked.locked).toBe(true);
    expect(locked.lockedUntil).toBeGreaterThan(Date.now());
  });

  it('unlockAccount works without token (admin unlock)', async () => {
    const accountId = 'user5';
    const ipAddress = '1.2.3.8';

    for (let i = 0; i < 10; i++) {
      await manager.recordAttempt({ accountId, ipAddress, success: false });
    }
    expect(manager.getStatus(accountId, ipAddress).locked).toBe(true);

    const result = manager.unlockAccount(accountId);
    expect(result).toBe(true);

    const status = manager.getStatus(accountId, ipAddress);
    expect(status.locked).toBe(false);
  });

  it('unlockAccount works with valid token', async () => {
    const accountId = 'user6';
    const ipAddress = '1.2.3.9';

    let unlockToken: string | undefined;
    for (let i = 0; i < 10; i++) {
      const r = await manager.recordAttempt({ accountId, ipAddress, success: false });
      if (r.unlockToken) unlockToken = r.unlockToken;
    }

    expect(unlockToken).toBeDefined();
    const result = manager.unlockAccount(accountId, unlockToken);
    expect(result).toBe(true);

    expect(manager.getStatus(accountId, ipAddress).locked).toBe(false);
  });

  it('unlockAccount returns false when account is not locked', () => {
    const result = manager.unlockAccount('nonexistent_user');
    expect(result).toBe(false);
  });

  it('listAttempts returns records sorted newest-first', async () => {
    const accountId = 'user7';
    const ipAddress = '10.0.0.1';

    await manager.recordAttempt({ accountId, ipAddress, success: false });
    await manager.recordAttempt({ accountId, ipAddress, success: true });
    await manager.recordAttempt({ accountId, ipAddress, success: false, reason: 'bad_password' });

    const list = manager.listAttempts();
    expect(list.length).toBeGreaterThanOrEqual(3);

    // Should be sorted newest-first
    for (let i = 0; i < list.length - 1; i++) {
      expect(list[i].createdAt).toBeGreaterThanOrEqual(list[i + 1].createdAt);
    }
  });

  it('getStatus shows progressive delay between attempts', async () => {
    const accountId = 'user8';
    const ipAddress = '10.0.0.2';

    // First failure: should have some delay
    await manager.recordAttempt({ accountId, ipAddress, success: false });
    const status1 = manager.getStatus(accountId, ipAddress);
    expect(status1.delayMs).toBeGreaterThan(0);
    expect(status1.delayUntil).toBeDefined();

    // Second failure: delay should be greater
    await manager.recordAttempt({ accountId, ipAddress, success: false });
    const status2 = manager.getStatus(accountId, ipAddress);
    expect(status2.delayMs).toBeGreaterThan(status1.delayMs);
  });

  it('captchaRequired after 3+ failed attempts from same IP', async () => {
    const accountId = 'user9';
    const ipAddress = '10.0.0.3';

    // Before 3 failures
    const before = manager.getStatus(accountId, ipAddress);
    expect(before.captchaRequired).toBe(false);

    for (let i = 0; i < 3; i++) {
      await manager.recordAttempt({ accountId, ipAddress, success: false });
    }

    const after = manager.getStatus(accountId, ipAddress);
    expect(after.captchaRequired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HTTP endpoint integration tests
// ---------------------------------------------------------------------------

describe('GET /auth/lockout/status/:identifier', () => {
  it('returns lockout status for an unknown identifier', async () => {
    const res = await call<{ identifier: string; status: { locked: boolean } }>(
      'GET',
      '/auth/lockout/status/unknown_user:127.0.0.1',
    );
    expect(res.status).toBe(200);
    expect(res.body.identifier).toBe('unknown_user:127.0.0.1');
    expect(res.body.status.locked).toBe(false);
  });
});

describe('POST /auth/lockout/attempt', () => {
  it('records a failed attempt and returns result', async () => {
    const res = await call<{ recorded: boolean }>(
      'POST',
      '/auth/lockout/attempt',
      {
        accountId: 'http_user1',
        ipAddress: '192.168.1.1',
        success: false,
        reason: 'bad_password',
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(true);
  });

  it('records a successful attempt', async () => {
    const res = await call<{ recorded: boolean }>(
      'POST',
      '/auth/lockout/attempt',
      {
        accountId: 'http_user2',
        ipAddress: '192.168.1.2',
        success: true,
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(true);
  });

  it('returns 400 when accountId is missing', async () => {
    const res = await call('POST', '/auth/lockout/attempt', {
      ipAddress: '192.168.1.3',
      success: false,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when ipAddress is missing', async () => {
    const res = await call('POST', '/auth/lockout/attempt', {
      accountId: 'http_user3',
      success: false,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when success flag is missing', async () => {
    const res = await call('POST', '/auth/lockout/attempt', {
      accountId: 'http_user4',
      ipAddress: '192.168.1.4',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/lockout/unlock/:accountId', () => {
  it('returns 404 when account is not locked', async () => {
    const res = await call('POST', '/auth/lockout/unlock/not_locked_user', {});
    expect(res.status).toBe(404);
  });

  it('unlocks a locked account without token', async () => {
    // Lock the account via 10 failures
    for (let i = 0; i < 10; i++) {
      await call('POST', '/auth/lockout/attempt', {
        accountId: 'http_lock_user',
        ipAddress: '10.1.1.1',
        success: false,
      });
    }

    const unlock = await call<{ unlocked: boolean; accountId: string }>(
      'POST',
      '/auth/lockout/unlock/http_lock_user',
      {},
    );
    expect(unlock.status).toBe(200);
    expect(unlock.body.unlocked).toBe(true);
    expect(unlock.body.accountId).toBe('http_lock_user');
  });
});

describe('GET /auth/lockout/attempts', () => {
  it('returns a list of attempts with total count', async () => {
    const res = await call<{ attempts: unknown[]; total: number }>(
      'GET',
      '/auth/lockout/attempts',
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.attempts)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.total).toBe(res.body.attempts.length);
  });
});

describe('DELETE /auth/lockout/clear/:identifier', () => {
  it('clears lockout state for an identifier', async () => {
    const res = await call<{
      cleared: boolean;
      identifier: string;
      accountId: string;
    }>('DELETE', '/auth/lockout/clear/clear_user:10.2.2.2');
    expect(res.status).toBe(200);
    expect(res.body.cleared).toBe(true);
    expect(res.body.identifier).toBe('clear_user:10.2.2.2');
    expect(res.body.accountId).toBe('clear_user');
  });
});
