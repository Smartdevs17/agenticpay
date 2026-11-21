import { Request, Response, NextFunction } from 'express';
import { resolveUserTier, resolveClientKey, UserTier, RedisClient } from './rate-limit.js';
import { getSharedRateLimitRedis } from '../config/rate-limit-redis.js';

// ---------------------------------------------------------------------------
// Sliding window log algorithm
//
// Unlike a fixed window (which allows up to 2x the limit at window edges) or
// a token bucket (which allows sustained bursts up to capacity), a sliding
// window log tracks individual request timestamps within a rolling window
// and rejects once the count in the trailing `windowMs` exceeds `limit`.
// This gives an exact, smooth rate limit with no boundary exploit.
// ---------------------------------------------------------------------------

export interface SlidingWindowConfig {
  /** Width of the rolling window in milliseconds */
  windowMs: number;
  /** Max requests allowed inside the window */
  limit: number;
}

export interface GraduatedPenaltyConfig {
  /** Ratio of limit usage (0-1) at which a warning header is attached but the request still passes */
  warnAtRatio: number;
  /** Ratio of limit usage (0-1) at which requests are throttled (delayed) instead of rejected outright */
  throttleAtRatio: number;
  /** Consecutive throttled windows after which the client is hard-blocked for `blockDurationMs` */
  blockAfterThrottledWindows: number;
  /** Duration of a hard block once triggered */
  blockDurationMs: number;
}

export interface EndpointSlidingWindowConfig {
  window: SlidingWindowConfig;
  penalties: GraduatedPenaltyConfig;
}

export const DEFAULT_GRADUATED_PENALTIES: GraduatedPenaltyConfig = {
  warnAtRatio: 0.7,
  throttleAtRatio: 0.9,
  blockAfterThrottledWindows: 3,
  blockDurationMs: 60_000,
};

/**
 * Per-endpoint sliding-window configuration. Critical/sensitive endpoints
 * get tighter windows and stricter penalty curves; everything else falls
 * back to DEFAULT_SLIDING_WINDOW.
 */
export const ENDPOINT_SLIDING_WINDOWS: Record<string, Record<UserTier, EndpointSlidingWindowConfig>> = {
  '/api/v1/withdrawals': {
    free: { window: { windowMs: 60_000, limit: 3 }, penalties: { ...DEFAULT_GRADUATED_PENALTIES, blockDurationMs: 300_000 } },
    pro: { window: { windowMs: 60_000, limit: 10 }, penalties: { ...DEFAULT_GRADUATED_PENALTIES, blockDurationMs: 180_000 } },
    enterprise: { window: { windowMs: 60_000, limit: 30 }, penalties: { ...DEFAULT_GRADUATED_PENALTIES, blockDurationMs: 120_000 } },
  },
  '/api/v1/auth': {
    free: { window: { windowMs: 60_000, limit: 5 }, penalties: { ...DEFAULT_GRADUATED_PENALTIES, blockDurationMs: 600_000 } },
    pro: { window: { windowMs: 60_000, limit: 10 }, penalties: { ...DEFAULT_GRADUATED_PENALTIES, blockDurationMs: 300_000 } },
    enterprise: { window: { windowMs: 60_000, limit: 20 }, penalties: { ...DEFAULT_GRADUATED_PENALTIES, blockDurationMs: 180_000 } },
  },
  '/api/v1/invoice': {
    free: { window: { windowMs: 60_000, limit: 20 }, penalties: DEFAULT_GRADUATED_PENALTIES },
    pro: { window: { windowMs: 60_000, limit: 100 }, penalties: DEFAULT_GRADUATED_PENALTIES },
    enterprise: { window: { windowMs: 60_000, limit: 500 }, penalties: DEFAULT_GRADUATED_PENALTIES },
  },
};

export const DEFAULT_SLIDING_WINDOW: Record<UserTier, EndpointSlidingWindowConfig> = {
  free: { window: { windowMs: 60_000, limit: 60 }, penalties: DEFAULT_GRADUATED_PENALTIES },
  pro: { window: { windowMs: 60_000, limit: 600 }, penalties: DEFAULT_GRADUATED_PENALTIES },
  enterprise: { window: { windowMs: 60_000, limit: 3000 }, penalties: DEFAULT_GRADUATED_PENALTIES },
};

function resolveEndpointWindow(path: string, tier: UserTier): EndpointSlidingWindowConfig {
  for (const [prefix, cfg] of Object.entries(ENDPOINT_SLIDING_WINDOWS)) {
    if (path.startsWith(prefix)) return cfg[tier];
  }
  return DEFAULT_SLIDING_WINDOW[tier];
}

function matchEndpointLabel(path: string): string {
  for (const prefix of Object.keys(ENDPOINT_SLIDING_WINDOWS)) {
    if (path.startsWith(prefix)) return prefix;
  }
  return 'global';
}

// ---------------------------------------------------------------------------
// In-memory sliding window store (per bucket key -> sorted timestamps)
// ---------------------------------------------------------------------------

interface WindowState {
  timestamps: number[];
  consecutiveThrottledWindows: number;
  blockedUntilMs: number;
}

const memoryStore = new Map<string, WindowState>();

function pruneTimestamps(timestamps: number[], nowMs: number, windowMs: number): number[] {
  const cutoff = nowMs - windowMs;
  let start = 0;
  while (start < timestamps.length && timestamps[start] < cutoff) start++;
  return start === 0 ? timestamps : timestamps.slice(start);
}

export type PenaltyLevel = 'ok' | 'warning' | 'throttle' | 'block';

export interface SlidingWindowResult {
  level: PenaltyLevel;
  count: number;
  limit: number;
  remaining: number;
  retryAfterMs: number;
}

function evaluateInMemory(
  key: string,
  cfg: EndpointSlidingWindowConfig,
  nowMs: number,
): SlidingWindowResult {
  const { window, penalties } = cfg;
  let state = memoryStore.get(key);
  if (!state) {
    state = { timestamps: [], consecutiveThrottledWindows: 0, blockedUntilMs: 0 };
  }

  if (state.blockedUntilMs > nowMs) {
    return {
      level: 'block',
      count: state.timestamps.length,
      limit: window.limit,
      remaining: 0,
      retryAfterMs: state.blockedUntilMs - nowMs,
    };
  }

  state.timestamps = pruneTimestamps(state.timestamps, nowMs, window.windowMs);
  const countBefore = state.timestamps.length;
  const ratio = countBefore / window.limit;

  let level: PenaltyLevel = 'ok';
  if (countBefore >= window.limit) {
    level = 'throttle';
    state.consecutiveThrottledWindows += 1;
    if (state.consecutiveThrottledWindows >= penalties.blockAfterThrottledWindows) {
      state.blockedUntilMs = nowMs + penalties.blockDurationMs;
      state.consecutiveThrottledWindows = 0;
      memoryStore.set(key, state);
      return {
        level: 'block',
        count: countBefore,
        limit: window.limit,
        remaining: 0,
        retryAfterMs: penalties.blockDurationMs,
      };
    }
  } else if (ratio >= penalties.throttleAtRatio) {
    level = 'throttle';
  } else if (ratio >= penalties.warnAtRatio) {
    level = 'warning';
  } else {
    state.consecutiveThrottledWindows = 0;
  }

  if (level !== 'throttle' || countBefore < window.limit) {
    state.timestamps.push(nowMs);
  }

  memoryStore.set(key, state);

  const count = state.timestamps.length;
  const oldestInWindow = state.timestamps[0] ?? nowMs;
  const retryAfterMs = level === 'throttle' || level === 'block'
    ? Math.max(0, oldestInWindow + window.windowMs - nowMs)
    : 0;

  return {
    level,
    count,
    limit: window.limit,
    remaining: Math.max(0, window.limit - count),
    retryAfterMs,
  };
}

// ---------------------------------------------------------------------------
// Redis-backed sliding window (sorted set per bucket key)
// ---------------------------------------------------------------------------

const LUA_SLIDING_WINDOW = `
local key = KEYS[1]
local block_key = KEYS[2]
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local throttle_ratio = tonumber(ARGV[4])
local warn_ratio = tonumber(ARGV[5])
local block_after = tonumber(ARGV[6])
local block_duration_ms = tonumber(ARGV[7])
local ttl_sec = tonumber(ARGV[8])

local blocked_until = tonumber(redis.call('GET', block_key) or '0')
if blocked_until > now_ms then
  return {3, redis.call('ZCARD', key), limit, blocked_until - now_ms, 0}
end

local cutoff = now_ms - window_ms
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count_before = redis.call('ZCARD', key)

local level = 0 -- 0 ok, 1 warning, 2 throttle, 3 block
local consecutive_key = key .. ':cw'
local consecutive = tonumber(redis.call('GET', consecutive_key) or '0')

if count_before >= limit then
  level = 2
  consecutive = consecutive + 1
  if consecutive >= block_after then
    redis.call('SET', block_key, now_ms + block_duration_ms, 'PX', block_duration_ms)
    redis.call('SET', consecutive_key, '0', 'PX', window_ms)
    return {3, count_before, limit, block_duration_ms, 0}
  end
  redis.call('SET', consecutive_key, tostring(consecutive), 'PX', window_ms)
else
  local ratio = count_before / limit
  if ratio >= throttle_ratio then
    level = 2
  elseif ratio >= warn_ratio then
    level = 1
  else
    redis.call('SET', consecutive_key, '0', 'PX', window_ms)
  end
end

if level < 2 or count_before < limit then
  redis.call('ZADD', key, now_ms, now_ms .. '-' .. math.random(1000000))
  redis.call('PEXPIRE', key, ttl_sec * 1000)
end

local count_after = redis.call('ZCARD', key)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retry_after = 0
if level >= 2 and oldest[2] then
  retry_after = math.max(0, tonumber(oldest[2]) + window_ms - now_ms)
end

return {level, count_after, limit, retry_after, 0}
`;

async function evaluateRedis(
  redis: RedisClient,
  key: string,
  cfg: EndpointSlidingWindowConfig,
  nowMs: number,
): Promise<SlidingWindowResult> {
  const { window, penalties } = cfg;
  const ttlSec = Math.ceil(window.windowMs / 1000) + 60;
  const result: [number, number, number, number, number] = await redis.eval(
    LUA_SLIDING_WINDOW,
    2,
    `swl:${key}`,
    `swl:${key}:blocked`,
    String(nowMs),
    String(window.windowMs),
    String(window.limit),
    String(penalties.throttleAtRatio),
    String(penalties.warnAtRatio),
    String(penalties.blockAfterThrottledWindows),
    String(penalties.blockDurationMs),
    String(ttlSec),
  );

  const levels: PenaltyLevel[] = ['ok', 'warning', 'throttle', 'block'];
  const [levelIdx, count, limit, retryAfterMs] = result;
  return {
    level: levels[levelIdx] ?? 'ok',
    count,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterMs,
  };
}

// ---------------------------------------------------------------------------
// Intelligent client identification
//
// Combines API key / bearer token identity (when present) with a fingerprint
// of IP + User-Agent so that anonymous clients can't trivially evade limits
// by omitting headers, while authenticated clients are tracked by identity
// rather than IP (so NAT'd offices don't collide).
// ---------------------------------------------------------------------------

export function resolveIntelligentClientKey(req: Request): string {
  const identityKey = resolveClientKey(req);
  if (identityKey !== (req.ip ?? 'unknown')) return identityKey;

  const ua = req.headers['user-agent'];
  const uaFingerprint = typeof ua === 'string' ? ua.slice(0, 64) : 'no-ua';
  return `${req.ip ?? 'unknown'}::${uaFingerprint}`;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export interface SlidingWindowOptions {
  keyPrefix?: string;
  redisClient?: RedisClient | null;
}

export function slidingWindowRateLimit(opts: SlidingWindowOptions = {}) {
  const { keyPrefix = 'sw', redisClient = null } = opts;

  return async function slidingWindowMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const tier = resolveUserTier(req);
    const clientKey = resolveIntelligentClientKey(req);
    const cfg = resolveEndpointWindow(req.path, tier);
    const endpointLabel = matchEndpointLabel(req.path);
    const bucketKey = `${keyPrefix}:${tier}:${clientKey}:${endpointLabel}`;
    const nowMs = Date.now();

    let result: SlidingWindowResult;
    try {
      const activeRedis = redisClient ?? (await getSharedRateLimitRedis());
      result = activeRedis
        ? await evaluateRedis(activeRedis, bucketKey, cfg, nowMs)
        : evaluateInMemory(bucketKey, cfg, nowMs);
    } catch (err) {
      console.warn('[SlidingWindowRateLimit] backing store error, failing open:', err);
      result = { level: 'ok', count: 0, limit: cfg.window.limit, remaining: cfg.window.limit, retryAfterMs: 0 };
    }

    res.setHeader('X-SlidingWindow-Limit', String(result.limit));
    res.setHeader('X-SlidingWindow-Remaining', String(result.remaining));
    res.setHeader('X-SlidingWindow-Window-Ms', String(cfg.window.windowMs));
    res.setHeader('X-SlidingWindow-Level', result.level);

    if (result.level === 'warning') {
      res.setHeader('X-SlidingWindow-Warning', 'approaching-limit');
      next();
      return;
    }

    if (result.level === 'throttle') {
      res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_THROTTLED',
          message: `Request rate for '${endpointLabel}' exceeds the sliding window limit. Retry after ${Math.ceil(result.retryAfterMs / 1000)}s.`,
          status: 429,
          level: 'throttle',
          retryAfterMs: result.retryAfterMs,
          tier,
          limit: result.limit,
        },
      });
      return;
    }

    if (result.level === 'block') {
      res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      res.status(403).json({
        error: {
          code: 'RATE_LIMIT_BLOCKED',
          message: `Client temporarily blocked for sustained rate-limit violations on '${endpointLabel}'. Retry after ${Math.ceil(result.retryAfterMs / 1000)}s.`,
          status: 403,
          level: 'block',
          retryAfterMs: result.retryAfterMs,
          tier,
        },
      });
      return;
    }

    next();
  };
}

/** Test/maintenance helper to reset the in-memory store between test runs */
export function resetSlidingWindowMemoryStore(): void {
  memoryStore.clear();
}
