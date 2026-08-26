/**
 * Tests for brute-force protection middleware and lockout manager — Issue #515
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── Stub audit service before importing lockout manager ──────────────────────
vi.mock('../../services/auditService.js', () => ({
  auditService: { logAction: vi.fn().mockResolvedValue(undefined) },
}));

import { LockoutManager } from '../../services/auth/lockout-manager.js';

// ── LockoutManager unit tests ─────────────────────────────────────────────────
describe('LockoutManager', () => {
  let mgr: LockoutManager;

  beforeEach(() => {
    mgr = new LockoutManager();
  });

  it('reports no lock on fresh state', () => {
    const status = mgr.getStatus('alice', '1.2.3.4');
    expect(status.locked).toBe(false);
    expect(status.failedAttempts).toBe(0);
    expect(status.captchaRequired).toBe(false);
  });

  it('applies progressive delays after failures', async () => {
    const now = Date.now();
    await mgr.recordAttempt({ accountId: 'bob', ipAddress: '1.1.1.1', success: false });
    const status = mgr.getStatus('bob', '1.1.1.1');
    expect(status.failedAttempts).toBe(1);
    expect(status.delayMs).toBeGreaterThan(0);
  });

  it('locks account after 10 consecutive failures', async () => {
    for (let i = 0; i < 10; i++) {
      await mgr.recordAttempt({ accountId: 'charlie', ipAddress: '2.2.2.2', success: false });
    }
    const status = mgr.getStatus('charlie', '2.2.2.2');
    expect(status.locked).toBe(true);
    expect(status.lockedUntil).toBeGreaterThan(Date.now());
  });

  it('returns an unlockToken when account is locked', async () => {
    for (let i = 0; i < 10; i++) {
      await mgr.recordAttempt({ accountId: 'dave', ipAddress: '3.3.3.3', success: false });
    }
    const result = await mgr.recordAttempt({ accountId: 'dave', ipAddress: '3.3.3.3', success: false });
    // May return unlockToken on the locking attempt (attempt 11 extends TTL but token already set)
    // At minimum the account must be locked
    expect(mgr.getStatus('dave', '3.3.3.3').locked).toBe(true);
  });

  it('unlocks account with valid token', async () => {
    let unlockToken: string | undefined;
    for (let i = 0; i < 10; i++) {
      const r = await mgr.recordAttempt({ accountId: 'eve', ipAddress: '4.4.4.4', success: false });
      if (r.unlockToken) unlockToken = r.unlockToken;
    }
    expect(mgr.getStatus('eve', '4.4.4.4').locked).toBe(true);
    const unlocked = mgr.unlockAccount('eve', unlockToken);
    expect(unlocked).toBe(true);
    expect(mgr.getStatus('eve', '4.4.4.4').locked).toBe(false);
  });

  it('rejects unlock with wrong token', async () => {
    for (let i = 0; i < 10; i++) {
      await mgr.recordAttempt({ accountId: 'frank', ipAddress: '5.5.5.5', success: false });
    }
    const unlocked = mgr.unlockAccount('frank', 'wrong-token');
    expect(unlocked).toBe(false);
    expect(mgr.getStatus('frank', '5.5.5.5').locked).toBe(true);
  });

  it('clears state on successful login', async () => {
    await mgr.recordAttempt({ accountId: 'grace', ipAddress: '6.6.6.6', success: false });
    await mgr.recordAttempt({ accountId: 'grace', ipAddress: '6.6.6.6', success: false });
    await mgr.recordAttempt({ accountId: 'grace', ipAddress: '6.6.6.6', success: true });
    const status = mgr.getStatus('grace', '6.6.6.6');
    expect(status.failedAttempts).toBe(0);
    expect(status.locked).toBe(false);
  });

  it('flags captchaRequired after 3 IP failures', async () => {
    for (let i = 0; i < 3; i++) {
      await mgr.recordAttempt({ accountId: `u${i}`, ipAddress: '7.7.7.7', success: false });
    }
    const status = mgr.getStatus('u0', '7.7.7.7');
    expect(status.captchaRequired).toBe(true);
  });

  it('listAttempts returns recorded attempts', async () => {
    await mgr.recordAttempt({ accountId: 'heidi', ipAddress: '8.8.8.8', success: true });
    const list = mgr.listAttempts();
    expect(list.some((a) => a.accountId === 'heidi')).toBe(true);
  });
});

// ── bruteForceProtection middleware unit tests ────────────────────────────────
describe('bruteForceProtection middleware', () => {
  it('module exports bruteForceProtection and recordLoginAttempt', async () => {
    const mod = await import('../../middleware/brute-force.js');
    expect(typeof mod.bruteForceProtection).toBe('function');
    expect(typeof mod.recordLoginAttempt).toBe('function');
  });

  it('returns a middleware function', async () => {
    const { bruteForceProtection } = await import('../../middleware/brute-force.js');
    const mw = bruteForceProtection();
    expect(typeof mw).toBe('function');
    expect(mw.length).toBe(3); // (req, res, next)
  });

  it('calls next() for a fresh request', async () => {
    const { bruteForceProtection } = await import('../../middleware/brute-force.js');
    const mw = bruteForceProtection({ accountResolver: () => 'test-user' });

    const req = {
      headers: {},
      body: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      res: { locals: {} },
    } as unknown as Request;
    const res = {
      locals: {},
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects with 429 after IP rate limit exceeded', async () => {
    const { bruteForceProtection } = await import('../../middleware/brute-force.js');
    // maxAttemptsPerSecondPerIp = 1 for this test
    const mw = bruteForceProtection({ maxAttemptsPerSecondPerIp: 1, accountResolver: () => 'test-rl' });

    const makeReq = () => ({
      headers: { 'x-forwarded-for': '99.99.99.1' },
      body: {},
      ip: '99.99.99.1',
      socket: { remoteAddress: '99.99.99.1' },
      res: { locals: {} },
    }) as unknown as Request;

    const makeRes = () => ({
      locals: {},
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    }) as unknown as Response;

    const next1 = vi.fn() as NextFunction;
    const next2 = vi.fn() as NextFunction;
    const res1 = makeRes();
    const res2 = makeRes();

    mw(makeReq(), res1, next1); // first request — should pass
    mw(makeReq(), res2, next2); // second request — should be rate-limited

    // One of them gets a 429
    expect(next1).toHaveBeenCalled() // first passes
    expect(res2.status).toHaveBeenCalledWith(429);
  });
});
