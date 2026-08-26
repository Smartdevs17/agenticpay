import { createHash, randomBytes } from 'node:crypto';
import { auditService } from '../auditService.js';

const ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1000;
const AUTO_UNLOCK_MS = 24 * 60 * 60 * 1000;
const PROGRESSIVE_DELAYS_MS = [1_000, 5_000, 30_000, 120_000, 600_000, 3_600_000];
const LOCKOUT_THRESHOLD = 10;

export interface LoginAttemptRecord {
  accountId: string;
  ipAddress: string;
  userAgent?: string;
  success: boolean;
  reason?: string;
  createdAt: number;
}

export interface LockoutState {
  accountId: string;
  ipAddress: string;
  failedAttempts: number;
  lastFailedAt?: number;
  lockedUntil?: number;
  unlockTokenHash?: string;
}

const attempts: LoginAttemptRecord[] = [];
const lockouts = new Map<string, LockoutState>();

function key(accountId: string, ipAddress: string): string {
  return `${accountId}:${ipAddress}`;
}

function accountStates(accountId: string): LockoutState[] {
  return [...lockouts.values()].filter((state) => state.accountId === accountId);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class LockoutManager {
  getStatus(accountId: string, ipAddress: string, now = Date.now()) {
    const state = lockouts.get(key(accountId, ipAddress));
    const accountLockedUntil = accountStates(accountId)
      .map((item) => item.lockedUntil ?? 0)
      .filter((lockedUntil) => lockedUntil > now)
      .sort((a, b) => b - a)[0];
    const failedFromIp = attempts.filter(
      (attempt) => attempt.ipAddress === ipAddress && !attempt.success && attempt.createdAt >= now - ATTEMPT_WINDOW_MS
    ).length;
    const failedAttempts = state?.failedAttempts ?? 0;
    const delayMs = failedAttempts > 0
      ? PROGRESSIVE_DELAYS_MS[Math.min(failedAttempts - 1, PROGRESSIVE_DELAYS_MS.length - 1)]
      : 0;
    const delayUntil = state?.lastFailedAt ? state.lastFailedAt + delayMs : undefined;
    const lockedUntil = Math.max(state?.lockedUntil ?? 0, accountLockedUntil ?? 0);

    return {
      locked: lockedUntil > now,
      lockedUntil: lockedUntil > now ? lockedUntil : undefined,
      delayMs,
      delayUntil: delayUntil && delayUntil > now ? delayUntil : undefined,
      failedAttempts,
      captchaRequired: failedFromIp >= 3,
    };
  }

  async recordAttempt(input: {
    accountId: string;
    ipAddress: string;
    userAgent?: string;
    success: boolean;
    reason?: string;
  }): Promise<{ lockedUntil?: number; unlockToken?: string }> {
    const now = Date.now();
    attempts.push({ ...input, createdAt: now });
    while (attempts.length > 20_000 || attempts[0]?.createdAt < now - ATTEMPT_WINDOW_MS) attempts.shift();

    await auditService.logAction({
      userId: input.accountId,
      action: input.success ? 'auth.login.success' : 'auth.login.failure',
      resource: 'auth',
      details: { reason: input.reason, captchaRequired: this.getStatus(input.accountId, input.ipAddress, now).captchaRequired },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    if (input.success) {
      lockouts.delete(key(input.accountId, input.ipAddress));
      return {};
    }

    const stateKey = key(input.accountId, input.ipAddress);
    const state = lockouts.get(stateKey) ?? {
      accountId: input.accountId,
      ipAddress: input.ipAddress,
      failedAttempts: 0,
    };
    state.failedAttempts += 1;
    state.lastFailedAt = now;

    let unlockToken: string | undefined;
    if (state.failedAttempts >= LOCKOUT_THRESHOLD) {
      state.lockedUntil = now + AUTO_UNLOCK_MS;
      unlockToken = randomBytes(32).toString('hex');
      state.unlockTokenHash = hashToken(unlockToken);
      await auditService.logAction({
        userId: input.accountId,
        action: 'auth.account.locked',
        resource: 'auth',
        details: { failedAttempts: state.failedAttempts, lockedUntil: new Date(state.lockedUntil).toISOString() },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
    }

    lockouts.set(stateKey, state);
    return { lockedUntil: state.lockedUntil, unlockToken };
  }

  unlockAccount(accountId: string, token?: string): boolean {
    const states = accountStates(accountId);
    if (states.length === 0) return false;
    let unlocked = false;

    for (const state of states) {
      if (token && state.unlockTokenHash && state.unlockTokenHash !== hashToken(token)) continue;
      lockouts.delete(key(state.accountId, state.ipAddress));
      unlocked = true;
    }

    if (unlocked) {
      void auditService.logAction({ userId: accountId, action: 'auth.account.unlocked', resource: 'auth' });
    }
    return unlocked;
  }

  listAttempts(): LoginAttemptRecord[] {
    return [...attempts].sort((a, b) => b.createdAt - a.createdAt);
  }
}

export const lockoutManager = new LockoutManager();
