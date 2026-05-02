import { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserTier = 'free' | 'pro' | 'enterprise';

export interface TokenBucketConfig {
  /** Maximum tokens (burst capacity) */
  capacity: number;
  /** Tokens added per second */
  refillRate: number;
  /** Extra burst tokens allowed above capacity (one-time) */
  burstAllowance: number;
}

export interface EndpointConfig {
  free: TokenBucketConfig;
  pro: TokenBucketConfig;
  enterprise: TokenBucketConfig;
}

export interface RateLimitOptions {
  /** Key prefix to namespace buckets */
  keyPrefix?: string;
  /** Override endpoint-level config */
  endpointConfig?: EndpointConfig;
  /** Redis client (ioredis-compatible). Falls back to in-memory when absent. */
  redisClient?: RedisClient | null;
}

/** Minimal ioredis-compatible interface so we don't hard-depend on ioredis */
export interface RedisClient {
  eval(script: string, numkeys: number, ...args: string[]): Promise<any>;
  set(key: string, value: string, exMode: string, exValue: number): Promise<any>;
  get(key: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Bucket state (in-memory fallback)
// ---------------------------------------------------------------------------

interface BucketState {
  tokens: number;
  lastRefillMs: number;
  burstUsed: boolean;
}

const inMemoryStore = new Map<string, BucketState>();

// ---------------------------------------------------------------------------
// Default tier configs
// ---------------------------------------------------------------------------

export const DEFAULT_TIER_CONFIGS: Record<UserTier, TokenBucketConfig> = {
  free:       { capacity: 60,   refillRate: 1,    burstAllowance: 10  },
  pro:        { capacity: 300,  refillRate: 5,    burstAllowance: 50  },
  enterprise: { capacity: 1200, refillRate: 20,   burstAllowance: 200 },
};

/** Per-endpoint overrides (stricter for sensitive paths) */
export const ENDPOINT_CONFIGS: Record<string, EndpointConfig> = {
  '/api/v1/invoice':      { free: { capacity: 10, refillRate: 0.1, burstAllowance: 2  }, pro: { capacity: 60,  refillRate: 1,  burstAllowance: 10 }, enterprise: { capacity: 300, refillRate: 5,  burstAllowance: 50 } },
  '/api/v1/verification': { free: { capacity: 20, refillRate: 0.3, burstAllowance: 5  }, pro: { capacity: 100, refillRate: 2,  burstAllowance: 20 }, enterprise: { capacity: 500, refillRate: 10, burstAllowance: 80 } },
  '/api/v1/stellar':      { free: { capacity: 30, refillRate: 0.5, burstAllowance: 5  }, pro: { capacity: 150, refillRate: 3,  burstAllowance: 25 }, enterprise: { capacity: 600, refillRate: 12, burstAllowance: 100 } },
};

// ---------------------------------------------------------------------------
// Analytics (in-memory, ring-buffer style)
// ---------------------------------------------------------------------------

export interface RateLimitEvent {
  ts: number;
  key: string;
  tier: UserTier;
  endpoint: string;
  allowed: boolean;
  tokensRemaining: number;
}

const MAX_ANALYTICS_EVENTS = 5000;
const analyticsEvents: RateLimitEvent[] = [];

export function recordAnalyticsEvent(event: RateLimitEvent): void {
  analyticsEvents.push(event);
  if (analyticsEvents.length > MAX_ANALYTICS_EVENTS) {
    analyticsEvents.shift();
  }
}

export function getAnalyticsSummary(windowMs = 60_000) {
  const cutoff = Date.now() - windowMs;
  const recent = analyticsEvents.filter(e => e.ts >= cutoff);
  const blocked = recent.filter(e => !e.allowed);

  const byTier: Record<string, { total: number; blocked: number }> = {};
  const byEndpoint: Record<string, { total: number; blocked: number }> = {};

  for (const e of recent) {
    byTier[e.tier] ??= { total: 0, blocked: 0 };
    byTier[e.tier].total++;
    if (!e.allowed) byTier[e.tier].blocked++;

    byEndpoint[e.endpoint] ??= { total: 0, blocked: 0 };
    byEndpoint[e.endpoint].total++;
    if (!e.allowed) byEndpoint[e.endpoint].blocked++;
  }

  return {
    windowMs,
    total: recent.length,
    blocked: blocked.length,
    allowRate: recent.length ? ((recent.length - blocked.length) / recent.length) : 1,
    byTier,
    byEndpoint,
  };
}

// ---------------------------------------------------------------------------
// Lua script for atomic Redis token-bucket
// ---------------------------------------------------------------------------

/**
 * Atomic token-bucket consume via Redis Lua.
 * KEYS[1] = bucket key
 * ARGV[1] = capacity, ARGV[2] = refillRate (tokens/sec), ARGV[3] = burstAllowance,
 * ARGV[4] = nowMs (string), ARGV[5] = ttlSeconds
 *
 * Returns: [allowed (0|1), tokensAfter (float*100 as int), retryAfterMs]
 */
const LUA_TOKEN_BUCKET = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local now_ms = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])

local data = redis.call('GET', key)
local tokens, last_ms

if data then
  local t, l = string.match(data, "([^:]+):([^:]+)")
  tokens = tonumber(t)
  last_ms = tonumber(l)
else
  tokens = capacity + burst
  last_ms = now_ms
end

-- Refill
local elapsed_sec = math.max(0, (now_ms - last_ms) / 1000)
tokens = math.min(capacity + burst, tokens + elapsed_sec * refill_rate)

local allowed = 0
local retry_after_ms = 0

if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry_after_ms = math.ceil((1 - tokens) / refill_rate * 1000)
end

redis.call('SET', key, tokens .. ':' .. now_ms, 'EX', ttl)
return {allowed, math.floor(tokens * 100), retry_after_ms}
`;

// ---------------------------------------------------------------------------
// In-memory token bucket consume
// ---------------------------------------------------------------------------

function consumeInMemory(
  key: string,
  cfg: TokenBucketConfig,
  nowMs: number,
): { allowed: boolean; tokensAfter: number; retryAfterMs: number } {
  let state = inMemoryStore.get(key);

  if (!state) {
    state = { tokens: cfg.capacity + cfg.burstAllowance, lastRefillMs: nowMs, burstUsed: false };
  }

  // Refill
  const elapsedSec = Math.max(0, (nowMs - state.lastRefillMs) / 1000);
  state.tokens = Math.min(cfg.capacity + cfg.burstAllowance, state.tokens + elapsedSec * cfg.refillRate);
  state.lastRefillMs = nowMs;

  let allowed = false;
  let retryAfterMs = 0;

  if (state.tokens >= 1) {
    state.tokens -= 1;
    allowed = true;
  } else {
    retryAfterMs = Math.ceil(((1 - state.tokens) / cfg.refillRate) * 1000);
  }

  inMemoryStore.set(key, state);
  return { allowed, tokensAfter: state.tokens, retryAfterMs };
}

// ---------------------------------------------------------------------------
// Redis token bucket consume
// ---------------------------------------------------------------------------

async function consumeRedis(
  redis: RedisClient,
  key: string,
  cfg: TokenBucketConfig,
  nowMs: number,
): Promise<{ allowed: boolean; tokensAfter: number; retryAfterMs: number }> {
  const ttl = Math.ceil((cfg.capacity + cfg.burstAllowance) / cfg.refillRate) + 60;
  const result: [number, number, number] = await redis.eval(
    LUA_TOKEN_BUCKET,
    1,
    key,
    String(cfg.capacity),
    String(cfg.refillRate),
    String(cfg.burstAllowance),
    String(nowMs),
    String(ttl),
  );
  return {
    allowed: result[0] === 1,
    tokensAfter: result[1] / 100,
    retryAfterMs: result[2],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function resolveUserTier(req: Request): UserTier {
  const h = req.headers['x-user-tier'];
  const v = (Array.isArray(h) ? h[0] : h)?.toLowerCase();
  if (v === 'pro' || v === 'enterprise') return v;
  return 'free';
}

export function resolveClientKey(req: Request): string {
  const auth = req.headers.authorization;
  if (auth) return auth;
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim()) return apiKey;
  return req.ip ?? 'unknown';
}

function resolveEndpointConfig(path: string, tier: UserTier): TokenBucketConfig {
  for (const [prefix, cfg] of Object.entries(ENDPOINT_CONFIGS)) {
    if (path.startsWith(prefix)) return cfg[tier];
  }
  return DEFAULT_TIER_CONFIGS[tier];
}

function matchEndpointLabel(path: string): string {
  for (const prefix of Object.keys(ENDPOINT_CONFIGS)) {
    if (path.startsWith(prefix)) return prefix;
  }
  return 'global';
}

// ---------------------------------------------------------------------------
// Main middleware factory
// ---------------------------------------------------------------------------

export function tokenBucketRateLimit(opts: RateLimitOptions = {}) {
  const { keyPrefix = 'rl', redisClient = null } = opts;

  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const tier = resolveUserTier(req);
    const clientKey = resolveClientKey(req);
    const cfg = opts.endpointConfig ? opts.endpointConfig[tier] : resolveEndpointConfig(req.path, tier);
    const bucketKey = `${keyPrefix}:${tier}:${clientKey}:${matchEndpointLabel(req.path)}`;
    const nowMs = Date.now();

    let result: { allowed: boolean; tokensAfter: number; retryAfterMs: number };

    try {
      if (redisClient) {
        result = await consumeRedis(redisClient, bucketKey, cfg, nowMs);
      } else {
        result = consumeInMemory(bucketKey, cfg, nowMs);
      }
    } catch (err) {
      // Redis failure — fail open, log warning
      console.warn('[RateLimit] Redis error, failing open:', err);
      result = { allowed: true, tokensAfter: cfg.capacity, retryAfterMs: 0 };
    }

    const resetSec = Math.ceil(result.retryAfterMs / 1000) || Math.ceil(cfg.capacity / cfg.refillRate);

    // Standard rate-limit headers
    res.setHeader('X-RateLimit-Tier', tier);
    res.setHeader('X-RateLimit-Limit', String(cfg.capacity));
    res.setHeader('X-RateLimit-Remaining', String(Math.floor(result.tokensAfter)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000) + resetSec));
    res.setHeader('X-RateLimit-Policy', `capacity=${cfg.capacity};refill=${cfg.refillRate}/s;burst=${cfg.burstAllowance}`);

    recordAnalyticsEvent({
      ts: nowMs,
      key: clientKey,
      tier,
      endpoint: matchEndpointLabel(req.path),
      allowed: result.allowed,
      tokensRemaining: result.tokensAfter,
    });

    if (!result.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit exceeded for tier '${tier}'. Please retry after ${Math.ceil(result.retryAfterMs / 1000)}s.`,
          status: 429,
          retryAfterMs: result.retryAfterMs,
          tier,
          policy: {
            capacity: cfg.capacity,
            refillRate: cfg.refillRate,
            burstAllowance: cfg.burstAllowance,
          },
        },
      });
      return;
    }

    next();
  };
}
