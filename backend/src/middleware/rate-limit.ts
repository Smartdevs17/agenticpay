import { Request, Response, NextFunction } from 'express';
import { lookupApiKey, maskApiKey } from '../services/api-key-registry.js';
import { getSharedRateLimitRedis } from '../config/rate-limit-redis.js';

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
  /** Enable sandbox mode with relaxed rate limits */
  sandboxMode?: boolean;
  /** Count batched sub-requests (e.g. bulk endpoints) against the bucket */
  batchCountHeader?: string;
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

// Hourly tier limits: free 1000/h, pro 10000/h, enterprise custom
const HOUR_SECONDS = 3600;

export const DEFAULT_TIER_CONFIGS: Record<UserTier, TokenBucketConfig> = {
  free:       { capacity: 1000,  refillRate: 1000 / HOUR_SECONDS,  burstAllowance: 100  },
  pro:        { capacity: 10000, refillRate: 10000 / HOUR_SECONDS, burstAllowance: 1000 },
  enterprise: { capacity: 50000, refillRate: 50000 / HOUR_SECONDS, burstAllowance: 5000 },
};

// Sandbox-specific relaxed rate limits for testing
export const SANDBOX_TIER_CONFIGS: Record<UserTier, TokenBucketConfig> = {
  free:       { capacity: 1000,  refillRate: 20,   burstAllowance: 200  },
  pro:        { capacity: 5000,  refillRate: 100,  burstAllowance: 1000 },
  enterprise: { capacity: 20000, refillRate: 400,  burstAllowance: 4000 },
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
export const analyticsEvents: RateLimitEvent[] = [];

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
  const apiKeyHeader = req.headers['x-api-key'];
  const apiKey = typeof apiKeyHeader === 'string' ? apiKeyHeader : undefined;
  if (apiKey) {
    const record = lookupApiKey(apiKey);
    if (record) return record.tier;
  }

  const h = req.headers['x-user-tier'];
  const v = (Array.isArray(h) ? h[0] : h)?.toLowerCase();
  if (v === 'pro' || v === 'enterprise') return v;
  return 'free';
}

export function resolveClientKey(req: Request): string {
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    const record = lookupApiKey(apiKeyHeader.trim());
    return record?.label ?? maskApiKey(apiKeyHeader.trim());
  }

  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return maskApiKey(auth.slice(7));
  if (auth) return maskApiKey(auth);
  return req.ip ?? 'unknown';
}

export function resolveCustomHourlyLimit(req: Request): number | null {
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader !== 'string') return null;
  const record = lookupApiKey(apiKeyHeader.trim());
  return record?.customHourlyLimit ?? null;
}

function resolveEndpointConfig(path: string, tier: UserTier, sandboxMode: boolean = false): TokenBucketConfig {
  for (const [prefix, cfg] of Object.entries(ENDPOINT_CONFIGS)) {
    if (path.startsWith(prefix)) {
      if (sandboxMode) {
        // Apply sandbox multiplier to endpoint configs
        const sandboxCfg = cfg[tier];
        return {
          capacity: sandboxCfg.capacity * 10,
          refillRate: sandboxCfg.refillRate * 10,
          burstAllowance: sandboxCfg.burstAllowance * 10,
        };
      }
      return cfg[tier];
    }
  }
  return sandboxMode ? SANDBOX_TIER_CONFIGS[tier] : DEFAULT_TIER_CONFIGS[tier];
}

function matchEndpointLabel(path: string): string {
  for (const prefix of Object.keys(ENDPOINT_CONFIGS)) {
    if (path.startsWith(prefix)) return prefix;
  }
  return 'global';
}

// ---------------------------------------------------------------------------
// Sustained-overuse circuit breaker
//
// A client that sustains >80 % block rate over a 5-minute sliding window is
// considered to be hammering the API.  We escalate from 429 → 503 for that
// key to signal back-pressure to upstream proxies and circuit breakers.
// ---------------------------------------------------------------------------

const OVERUSE_WINDOW_MS = 5 * 60 * 1_000;
const OVERUSE_BLOCK_RATE_THRESHOLD = 0.8;
const OVERUSE_MIN_REQUESTS = 20;

function isSustainedOveruse(clientKey: string): boolean {
  const cutoff = Date.now() - OVERUSE_WINDOW_MS;
  const keyEvents = analyticsEvents.filter((e) => e.key === clientKey && e.ts >= cutoff);
  if (keyEvents.length < OVERUSE_MIN_REQUESTS) return false;
  const blocked = keyEvents.filter((e) => !e.allowed).length;
  return blocked / keyEvents.length >= OVERUSE_BLOCK_RATE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Main middleware factory
// ---------------------------------------------------------------------------

export function tokenBucketRateLimit(opts: RateLimitOptions = {}) {
  const { keyPrefix = 'rl', redisClient = null, sandboxMode = false, batchCountHeader = 'x-batch-count' } = opts;

  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const tier = resolveUserTier(req);
    const clientKey = resolveClientKey(req);
    let cfg = opts.endpointConfig ? opts.endpointConfig[tier] : resolveEndpointConfig(req.path, tier, sandboxMode);

    const customHourly = resolveCustomHourlyLimit(req);
    if (customHourly && tier === 'enterprise') {
      cfg = {
        capacity: customHourly,
        refillRate: customHourly / HOUR_SECONDS,
        burstAllowance: Math.ceil(customHourly * 0.1),
      };
    }

    const batchCountRaw = req.headers[batchCountHeader];
    const batchCount = Math.max(1, Math.min(Number(batchCountRaw) || 1, 100));
    const bucketKey = `${keyPrefix}:${tier}:${clientKey}:${matchEndpointLabel(req.path)}`;
    const nowMs = Date.now();

    // Add sandbox header if in sandbox mode
    if (sandboxMode) {
      res.setHeader('X-Sandbox-Rate-Limit', 'relaxed');
    }

    let result: { allowed: boolean; tokensAfter: number; retryAfterMs: number };

    try {
      const activeRedis = redisClient ?? (await getSharedRateLimitRedis());
      let combined = { allowed: true, tokensAfter: cfg.capacity, retryAfterMs: 0 };

      for (let i = 0; i < batchCount; i++) {
        if (activeRedis) {
          combined = await consumeRedis(activeRedis, bucketKey, cfg, nowMs);
        } else {
          combined = consumeInMemory(bucketKey, cfg, nowMs);
        }
        if (!combined.allowed) break;
      }

      result = combined;
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
    res.setHeader('X-RateLimit-Policy', `capacity=${cfg.capacity};refill=${cfg.refillRate.toFixed(4)}/s;burst=${cfg.burstAllowance};window=3600s`);
    if (batchCount > 1) {
      res.setHeader('X-RateLimit-Batch-Count', String(batchCount));
    }

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

      // Escalate to 503 for clients sustaining a high block rate over 5 minutes
      const sustained = !sandboxMode && isSustainedOveruse(clientKey);
      const statusCode = sustained ? 503 : 429;
      const errorCode = sustained ? 'SUSTAINED_OVERUSE' : 'RATE_LIMIT_EXCEEDED';
      const message = sustained
        ? `Service temporarily unavailable: sustained overuse detected for tier '${tier}'. Back off and retry later.`
        : `Rate limit exceeded for tier '${tier}'. Please retry after ${Math.ceil(result.retryAfterMs / 1000)}s.`;

      res.status(statusCode).json({
        error: {
          code: errorCode,
          message,
          status: statusCode,
          retryAfterMs: result.retryAfterMs,
          tier,
          sustained,
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
