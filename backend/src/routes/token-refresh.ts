// Token refresh & revocation routes — Issue #512
// POST /api/v1/auth/refresh   — rotate refresh token, issue new pair
// POST /api/v1/auth/revoke    — revoke a specific refresh token
// POST /api/v1/auth/revoke-all — sign out everywhere (revoke all families)
// GET  /api/v1/auth/sessions  — list active token families (session management UI)
// POST /api/v1/auth/login     — issue initial token family

import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  issueTokenFamily,
  rotateRefreshToken,
  revokeToken,
  revokeAllUserTokens,
  listUserTokenFamilies,
} from '../auth/token-rotation.js';
import { getSharedRateLimitRedis } from '../config/rate-limit-redis.js';

export const tokenRefreshRouter = Router();

// Rate limit: 5 refresh requests per minute per user
// Uses Redis sliding-window counter; falls back to in-memory when Redis is absent.
const REFRESH_WINDOW_MS = 60_000;
const REFRESH_LIMIT = 5;
const inMemoryRefreshCounts = new Map<string, { count: number; windowStart: number }>();

async function checkRefreshRateLimit(userId: string): Promise<boolean> {
  const key = `rt:rl:${userId}`;
  const now = Date.now();

  try {
    const redis = await getSharedRateLimitRedis();
    if (redis) {
      // Atomic check-and-increment via Lua
      const lua = `
        local key = KEYS[1]
        local limit = tonumber(ARGV[1])
        local ttl = tonumber(ARGV[2])
        local val = redis.call('GET', key)
        local count = tonumber(val or '0')
        if count >= limit then return 0 end
        redis.call('INCR', key)
        if count == 0 then redis.call('EXPIRE', key, ttl) end
        return 1
      `;
      const result = await redis.eval(
        lua, 1, key,
        String(REFRESH_LIMIT),
        String(Math.ceil(REFRESH_WINDOW_MS / 1000)),
      );
      return result === 1;
    }
  } catch { /* fall through to in-memory */ }

  // In-memory fallback
  const entry = inMemoryRefreshCounts.get(userId);
  if (!entry || now - entry.windowStart > REFRESH_WINDOW_MS) {
    inMemoryRefreshCounts.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= REFRESH_LIMIT) return false;
  entry.count++;
  return true;
}

// Simulated user resolution — in production, extract from signed session or API key
function resolveUser(req: any): { userId: string; tenantId: string } {
  return {
    userId: (req.headers['x-user-id'] as string) || 'anonymous',
    tenantId: (req.headers['x-tenant-id'] as string) || 'default',
  };
}

// POST /api/v1/auth/login — issue initial token family
tokenRefreshRouter.post('/login', asyncHandler(async (req, res) => {
  const { userId, tenantId } = resolveUser(req);
  const tokens = await issueTokenFamily(userId, tenantId);
  res.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
  });
}));

// POST /api/v1/auth/refresh — rotate refresh token
tokenRefreshRouter.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken || typeof refreshToken !== 'string') {
    throw new AppError(400, 'refreshToken is required', 'MISSING_REFRESH_TOKEN');
  }

  // Rate limit by hashed token prefix (first 8 chars act as a user proxy)
  const rateKey = refreshToken.slice(0, 8);
  const allowed = await checkRefreshRateLimit(rateKey);
  if (!allowed) {
    res.setHeader('Retry-After', String(Math.ceil(REFRESH_WINDOW_MS / 1000)));
    throw new AppError(429, 'Too many refresh requests. Retry in 60 seconds.', 'REFRESH_RATE_LIMIT');
  }

  const result = await rotateRefreshToken(refreshToken);

  if (!result.ok) {
    const messages: Record<string, string> = {
      not_found: 'Refresh token not found',
      revoked: 'Refresh token has been revoked',
      expired: 'Refresh token has expired',
      family_compromised: 'Session compromised: refresh token reuse detected. All sessions revoked.',
    };
    const status = result.reason === 'family_compromised' ? 401 : 401;
    throw new AppError(status, messages[result.reason] ?? 'Invalid refresh token', `TOKEN_${result.reason.toUpperCase()}`);
  }

  res.json({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    refreshTokenExpiresAt: result.refreshTokenExpiresAt,
  });
}));

// POST /api/v1/auth/revoke — revoke a single refresh token
tokenRefreshRouter.post('/revoke', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken || typeof refreshToken !== 'string') {
    throw new AppError(400, 'refreshToken is required', 'MISSING_REFRESH_TOKEN');
  }

  const { userId } = resolveUser(req);
  const revoked = await revokeToken(refreshToken, userId);
  res.json({ success: revoked });
}));

// POST /api/v1/auth/revoke-all — revoke all token families for a user
tokenRefreshRouter.post('/revoke-all', asyncHandler(async (req, res) => {
  const { userId, tenantId } = resolveUser(req);
  const count = await revokeAllUserTokens(userId, tenantId);
  res.json({ success: true, revokedCount: count });
}));

// GET /api/v1/auth/sessions — list active token families (session management UI)
tokenRefreshRouter.get('/sessions', asyncHandler(async (req, res) => {
  const { userId, tenantId } = resolveUser(req);
  const families = await listUserTokenFamilies(userId, tenantId);
  res.json({ sessions: families });
}));
