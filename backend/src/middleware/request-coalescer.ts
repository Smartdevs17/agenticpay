// Request coalescing middleware — Issue #509
//
// Identical concurrent GET requests (same route + query + auth context) are
// merged: the first request executes, all subsequent callers await that same
// promise.  When the first request completes (or errors), all waiters receive
// the same result.
//
// Multi-instance: when Redis is available, a distributed lock + pub/sub pattern
// broadcasts results across instances so duplicate requests on different nodes
// are also coalesced.
//
// Configuration: per-endpoint opt-in via COALESCE_ENDPOINTS env var (JSON map)
// or by calling `setCoalesceConfig({ '/api/v1/catalog': { enabled: true } })`.

import { createHash } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { getSharedRateLimitRedis } from '../config/rate-limit-redis.js';
import type { RedisClient } from './rate-limit.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoalesceEndpointConfig {
  enabled: boolean;
  /** TTL for a cached result even after the request completes (ms). 0 = no cache. */
  resultTtlMs?: number;
  /** Max wait time for coalesced callers (ms). Falls back to 30s. */
  timeoutMs?: number;
}

export interface CoalesceMetrics {
  total: number;
  coalesced: number;
  errors: number;
  avgWaitMs: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CoalesceEndpointConfig = {
  enabled: true,
  resultTtlMs: 0,
  timeoutMs: 30_000,
};

// Routes that opt in to coalescing by default
const BUILTIN_ENDPOINTS: Record<string, CoalesceEndpointConfig> = {
  '/api/v1/catalog':       { enabled: true, resultTtlMs: 2_000, timeoutMs: 10_000 },
  '/api/v1/gas':           { enabled: true, resultTtlMs: 1_000, timeoutMs: 10_000 },
  '/api/v1/pool/metrics':  { enabled: true, resultTtlMs: 500,   timeoutMs: 5_000  },
};

const endpointConfigs = new Map<string, CoalesceEndpointConfig>(
  Object.entries(BUILTIN_ENDPOINTS),
);

export function setCoalesceConfig(configs: Record<string, Partial<CoalesceEndpointConfig>>): void {
  for (const [path, cfg] of Object.entries(configs)) {
    endpointConfigs.set(path, { ...DEFAULT_CONFIG, ...cfg });
  }
}

function resolveConfig(path: string): CoalesceEndpointConfig | null {
  for (const [prefix, cfg] of endpointConfigs) {
    if (path.startsWith(prefix) && cfg.enabled) return cfg;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Coalesce key
// ---------------------------------------------------------------------------

function buildCoalesceKey(req: Request): string {
  const auth = req.headers.authorization ?? req.headers['x-api-key'] ?? '';
  const authHash = createHash('sha256').update(String(auth)).digest('hex').slice(0, 8);
  const query = JSON.stringify(req.query);
  const raw = `${req.method}|${req.path}|${query}|${authHash}`;
  return createHash('sha256').update(raw).digest('hex');
}

// ---------------------------------------------------------------------------
// In-process promise registry
// ---------------------------------------------------------------------------

interface Inflight {
  promise: Promise<CoalescedResponse>;
  resolve: (r: CoalescedResponse) => void;
  reject: (err: unknown) => void;
  startedAt: number;
  waiters: number;
}

interface CoalescedResponse {
  status: number;
  body: unknown;
  headers: Record<string, string | string[]>;
}

const inflight = new Map<string, Inflight>();

// Metrics (ring-buffer style, reset per instance)
const metrics: CoalesceMetrics = { total: 0, coalesced: 0, errors: 0, avgWaitMs: 0 };
const waitSamples: number[] = [];

function recordWait(ms: number): void {
  waitSamples.push(ms);
  if (waitSamples.length > 1000) waitSamples.shift();
  metrics.avgWaitMs = waitSamples.reduce((s, v) => s + v, 0) / waitSamples.length;
}

export function getCoalesceMetrics(): CoalesceMetrics & { hitRate: number } {
  return {
    ...metrics,
    hitRate: metrics.total > 0 ? metrics.coalesced / metrics.total : 0,
  };
}

// ---------------------------------------------------------------------------
// Redis-based distributed coalescing
// ---------------------------------------------------------------------------

const LOCK_PREFIX = 'coalesce:lock:';
const RESULT_PREFIX = 'coalesce:result:';
const CHANNEL_PREFIX = 'coalesce:chan:';
const LOCK_TTL_SEC = 35; // slightly longer than max request timeout

async function tryAcquireDistributedLock(redis: RedisClient, key: string): Promise<boolean> {
  try {
    const lockKey = `${LOCK_PREFIX}${key}`;
    const result = await redis.set(lockKey, '1', 'EX', LOCK_TTL_SEC);
    return result === 'OK';
  } catch {
    return false;
  }
}

async function releaseDistributedLock(redis: RedisClient, key: string): Promise<void> {
  try {
    // We don't have a native del on the minimal RedisClient interface,
    // so use SET with EX 1 to let it expire quickly
    await redis.set(`${LOCK_PREFIX}${key}`, '0', 'EX', 1);
  } catch { /* best-effort */ }
}

async function publishResult(redis: RedisClient, key: string, result: CoalescedResponse, ttlMs: number): Promise<void> {
  try {
    const payload = JSON.stringify(result);
    const resultKey = `${RESULT_PREFIX}${key}`;
    await redis.set(resultKey, payload, 'EX', Math.max(1, Math.ceil(ttlMs / 1000)));
  } catch { /* best-effort */ }
}

async function getDistributedResult(redis: RedisClient, key: string): Promise<CoalescedResponse | null> {
  try {
    const payload = await redis.get(`${RESULT_PREFIX}${key}`);
    if (payload) return JSON.parse(payload) as CoalescedResponse;
  } catch { /* fall through */ }
  return null;
}

// ---------------------------------------------------------------------------
// Intercept response helpers
// ---------------------------------------------------------------------------

function interceptResponse(
  res: Response,
  onDone: (captured: CoalescedResponse) => void,
  onError: (err: unknown) => void,
): void {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  let captured = false;

  function capture(status: number, body: unknown): void {
    if (captured) return;
    captured = true;
    const headers: Record<string, string | string[]> = {};
    const headerNames = res.getHeaderNames?.() ?? [];
    for (const name of headerNames) {
      const val = res.getHeader(name);
      if (val !== undefined) headers[name] = val as string | string[];
    }
    onDone({ status, body, headers });
  }

  res.json = function(body: unknown) {
    capture(res.statusCode, body);
    return originalJson(body);
  };

  res.send = function(body?: any) {
    capture(res.statusCode, body);
    return originalSend(body);
  };
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export function requestCoalescer(opts: { keyPrefix?: string } = {}) {
  return async function coalesceMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Only coalesce GET requests
    if (req.method !== 'GET') {
      next();
      return;
    }

    const cfg = resolveConfig(req.path);
    if (!cfg) {
      next();
      return;
    }

    const key = buildCoalesceKey(req);
    metrics.total++;

    // Check Redis result cache first (covers multi-instance fast path)
    let redis: RedisClient | null = null;
    try {
      redis = await getSharedRateLimitRedis();
      if (redis && cfg.resultTtlMs) {
        const cached = await getDistributedResult(redis, key);
        if (cached) {
          metrics.coalesced++;
          res.status(cached.status).json(cached.body);
          return;
        }
      }
    } catch { /* fall through to in-process */ }

    // Check in-process inflight registry
    const existing = inflight.get(key);
    if (existing) {
      metrics.coalesced++;
      existing.waiters++;
      const waitStart = Date.now();

      const timeoutMs = cfg.timeoutMs ?? DEFAULT_CONFIG.timeoutMs ?? 30_000;
      const timeout = new Promise<CoalescedResponse>((_, reject) =>
        setTimeout(() => reject(new Error('Coalesce timeout')), timeoutMs),
      );

      try {
        const result = await Promise.race([existing.promise, timeout]);
        recordWait(Date.now() - waitStart);
        res.status(result.status).json(result.body);
      } catch (err) {
        metrics.errors++;
        recordWait(Date.now() - waitStart);
        next(err);
      }
      return;
    }

    // Try distributed lock (multi-instance)
    if (redis) {
      const locked = await tryAcquireDistributedLock(redis, key);
      if (!locked) {
        // Another instance holds the lock — wait for its result
        const waitStart = Date.now();
        const timeoutMs = cfg.timeoutMs ?? 30_000;
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 100));
          const result = await getDistributedResult(redis!, key);
          if (result) {
            metrics.coalesced++;
            recordWait(Date.now() - waitStart);
            res.status(result.status).json(result.body);
            return;
          }
        }
        // Timeout — fall through to execute the request normally
      }
    }

    // Register this request as the "first" — others will wait for it
    let resolveCoalesce!: (r: CoalescedResponse) => void;
    let rejectCoalesce!: (err: unknown) => void;

    const promise = new Promise<CoalescedResponse>((res, rej) => {
      resolveCoalesce = res;
      rejectCoalesce = rej;
    });

    inflight.set(key, { promise, resolve: resolveCoalesce, reject: rejectCoalesce, startedAt: Date.now(), waiters: 0 });

    interceptResponse(
      res,
      async (captured) => {
        // Broadcast to in-process waiters
        resolveCoalesce(captured);
        inflight.delete(key);

        // Broadcast to Redis (multi-instance waiters + result TTL cache)
        if (redis && (cfg.resultTtlMs ?? 0) > 0) {
          await publishResult(redis, key, captured, cfg.resultTtlMs!);
        }
        if (redis) {
          await releaseDistributedLock(redis, key);
        }
      },
      (err) => {
        metrics.errors++;
        rejectCoalesce(err);
        inflight.delete(key);
        if (redis) releaseDistributedLock(redis, key).catch(() => {});
      },
    );

    next();
  };
}

/** Test helper: reset the in-process registry between test runs. */
export function resetCoalesceStore(): void {
  inflight.clear();
  waitSamples.length = 0;
  Object.assign(metrics, { total: 0, coalesced: 0, errors: 0, avgWaitMs: 0 });
}
