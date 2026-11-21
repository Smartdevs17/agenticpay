import { Request, Response, NextFunction } from 'express';
import { lockoutManager } from '../services/auth/lockout-manager.js';

const ipBuckets = new Map<string, { count: number; resetAt: number }>();

export function bruteForceProtection(options: {
  accountResolver?: (req: Request) => string;
  maxAttemptsPerSecondPerIp?: number;
} = {}) {
  const maxPerSecond = options.maxAttemptsPerSecondPerIp ?? 3;
  const resolveAccount = options.accountResolver ?? ((req) => String(req.body?.email ?? req.headers['x-user-id'] ?? 'unknown'));

  return (req: Request, res: Response, next: NextFunction) => {
    const ipAddress = getIp(req);
    const now = Date.now();
    const bucket = ipBuckets.get(ipAddress) ?? { count: 0, resetAt: now + 1_000 };
    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + 1_000;
    }
    bucket.count += 1;
    ipBuckets.set(ipAddress, bucket);

    if (bucket.count > maxPerSecond) {
      res.setHeader('Retry-After', '1');
      res.status(429).json({ error: 'Too many login attempts from this IP' });
      return;
    }

    const accountId = resolveAccount(req);
    const status = lockoutManager.getStatus(accountId, ipAddress, now);
    res.locals.lockoutStatus = status;
    res.locals.loginAccountId = accountId;
    res.locals.loginIpAddress = ipAddress;

    if (status.locked) {
      res.status(423).json({
        error: 'Account is locked',
        lockedUntil: new Date(status.lockedUntil!).toISOString(),
      });
      return;
    }

    if (status.delayUntil) {
      const retryAfter = Math.ceil((status.delayUntil - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'Progressive login delay active',
        retryAfterSeconds: retryAfter,
        captchaRequired: status.captchaRequired,
      });
      return;
    }

    next();
  };
}

export async function recordLoginAttempt(req: Request, success: boolean, reason?: string) {
  return lockoutManager.recordAttempt({
    accountId: String(resolved(req, 'loginAccountId') ?? req.headers['x-user-id'] ?? req.body?.email ?? 'unknown'),
    ipAddress: String(resolved(req, 'loginIpAddress') ?? getIp(req)),
    userAgent: req.headers['user-agent'],
    success,
    reason,
  });
}

function resolved(req: Request, key: string): unknown {
  return (req.res?.locals as Record<string, unknown> | undefined)?.[key];
}

function getIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() || 'unknown';
  return req.ip || req.socket.remoteAddress || 'unknown';
}
