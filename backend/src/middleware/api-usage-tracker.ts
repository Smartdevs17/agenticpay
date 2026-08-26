import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';

const requestCounts = new Map<string, { hourly: number[]; daily: number[] }>();

function getWindowKey(keyId: string, windowMs: number): string {
  return `${keyId}:${Math.floor(Date.now() / windowMs)}`;
}

export async function apiUsageTracker(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const tenantId = (req.headers['x-tenant-id'] as string) ?? 'default';
  const keyId = (req.headers['x-api-key'] as string) ?? 'anonymous';
  const endpoint = req.originalUrl ?? req.path;
  const method = req.method;

  res.on('finish', async () => {
    const latencyMs = Date.now() - startTime;
    const statusCode = res.statusCode;
    const payloadSize = parseInt(res.getHeader('content-length') as string) || 0;

    try {
      await prisma.apiKeyUsage.create({
        data: {
          tenantId,
          keyId,
          endpoint,
          method,
          statusCode,
          latencyMs,
          payloadSize,
          ipAddress: req.ip,
        },
      });
    } catch (err) {
      console.warn('[API Usage Tracker] Failed to record usage:', (err as Error).message);
    }
  });

  next();
}

export function checkQuota(req: Request, res: Response, next: NextFunction) {
  const keyId = (req.headers['x-api-key'] as string) ?? 'anonymous';
  const hourWindow = 3600_000;
  const dayWindow = 86400_000;

  const hourKey = getWindowKey(keyId, hourWindow);
  const dayKey = getWindowKey(keyId, dayWindow);

  if (!requestCounts.has(keyId)) {
    requestCounts.set(keyId, { hourly: [], daily: [] });
  }
  const counts = requestCounts.get(keyId)!;

  counts.hourly.push(Date.now());
  counts.daily.push(Date.now());

  const hourAgo = Date.now() - hourWindow;
  const dayAgo = Date.now() - dayWindow;

  counts.hourly = counts.hourly.filter((t) => t > hourAgo);
  counts.daily = counts.daily.filter((t) => t > dayAgo);

  const hourlyCount = counts.hourly.length;
  const dailyCount = counts.daily.length;

  const hourlyLimit = parseInt(req.headers['x-rate-limit-hourly'] as string) || 1000;
  const dailyLimit = parseInt(req.headers['x-rate-limit-daily'] as string) || 10000;

  if (hourlyCount > hourlyLimit) {
    res.setHeader('Retry-After', '3600');
    res.status(429).json({
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Hourly quota exceeded', retryAfter: 3600 },
    });
    return;
  }

  if (dailyCount > dailyLimit) {
    res.setHeader('Retry-After', '86400');
    res.status(429).json({
      error: { code: 'DAILY_LIMIT_EXCEEDED', message: 'Daily quota exceeded', retryAfter: 86400 },
    });
    return;
  }

  res.setHeader('X-RateLimit-Hourly-Remaining', String(hourlyLimit - hourlyCount));
  res.setHeader('X-RateLimit-Daily-Remaining', String(dailyLimit - dailyCount));
  res.setHeader('X-RateLimit-Hourly-Limit', String(hourlyLimit));
  res.setHeader('X-RateLimit-Daily-Limit', String(dailyLimit));

  next();
}
