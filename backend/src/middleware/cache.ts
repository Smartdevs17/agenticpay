/**
 * cache.ts
 *
 * cacheControl() — Express middleware factory for Cache-Control + ETag support
 * with optional in-memory / Redis caching and conditional requests.
 *
 * ## Usage
 *
 * ```ts
 * import { cacheControl, CacheTTL } from '../middleware/cache.js';
 *
 * router.get('/catalog', cacheControl({ maxAge: CacheTTL.STATIC }), handler);
 * ```
 *
 * ## What it does
 *
 * 1. Sets `Cache-Control` on the way out (public/private, max-age, optional
 *    stale-while-revalidate).
 * 2. Computes a strong ETag (SHA-1 of the serialised JSON body, first 16 hex
 *    chars) and attaches it to the response.
 * 3. Honours `If-None-Match` (including comma lists and `*`) and responds
 *    `304 Not Modified` (weak comparison per RFC 7232) when the client already
 *    holds a fresh copy.
 * 4. With `inMemory: true`, stores responses in memory (mirrored to Redis when
 *    available) and serves subsequent requests directly from cache, tagging
 *    them with `X-Cache: HIT` / `X-Cache: STALE` / `X-Cache: MISS`.
 * 5. Error responses (status >= 400) are never cached or etagged.
 */

import { createHash } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { parseIfNoneMatch, weakMatch } from './etag.js';

export interface CacheOptions {
  /** Cache lifetime in seconds. 0 means `no-store`. */
  maxAge: number;
  /** Include `public`/`private` directive (default: public). */
  isPublic?: boolean;
  /** Seconds stale content may be served while being revalidated. */
  staleWhileRevalidate?: number;
  /** Serve responses from the in-memory (and Redis) cache. */
  inMemory?: boolean;
  /** Fixed override for the cache key. */
  cacheKey?: string;
  /** Do not cache bodies larger than this many bytes (default: 1 MiB). */
  maxBodySize?: number;
}

export const CacheTTL = {
  STATIC: 300,
  SHORT: 30,
  IMMUTABLE: 600,
  LONG: 3600,
  NONE: 0,
} as const;

// ─── Internal types ───────────────────────────────────────────────────────────

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
  createdAt: number;
  hitCount: number;
  etag: string;
}

// ─── MemoryCache ──────────────────────────────────────────────────────────────

class MemoryCache {
  private store = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor(maxSize = 2000) {
    this.maxSize = maxSize;
  }

  get<T>(key: string): { value: T; stale: boolean; etag: string } | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    entry.hitCount++;
    const stale = Date.now() > entry.expiresAt;
    return { value: entry.value as T, stale, etag: entry.etag };
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  set(key: string, value: unknown, ttlMs: number, etag = ''): void {
    if (this.store.size >= this.maxSize) {
      // Evict the oldest entry (Map iteration order = insertion order)
      const oldest = this.store.entries().next().value;
      if (oldest) this.store.delete(oldest[0]);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
      hitCount: 0,
      etag,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** All keys currently held by the cache (order = insertion order). */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  get size(): number {
    return this.store.size;
  }

  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  getStats() {
    const entries = Array.from(this.store.values());
    const totalHits = entries.reduce((sum, e) => sum + e.hitCount, 0);
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      totalHits,
      totalEntries: entries.length,
      avgHitsPerEntry: entries.length > 0 ? totalHits / entries.length : 0,
    };
  }
}

// ─── SingleFlight ─────────────────────────────────────────────────────────────

class SingleFlight {
  private inFlight = new Map<string, Promise<unknown>>();

  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fn().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  /** Number of operations currently being coalesced. */
  get inFlightCount(): number {
    return this.inFlight.size;
  }
}

// ─── CacheMonitor ─────────────────────────────────────────────────────────────

interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  inFlightRequests: number;
  memoryUsage: number;
}

class CacheMonitor {
  private hits = 0;
  private misses = 0;
  private sets = 0;
  private evictions = 0;

  recordHit(): void { this.hits++; }
  recordMiss(): void { this.misses++; }
  recordSet(): void { this.sets++; }
  recordEviction(): void { this.evictions++; }

  getStats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      evictions: this.evictions,
      inFlightRequests: singleFlight.inFlightCount,
      memoryUsage: memoryCache.size,
    };
  }

  get hitRatio(): number {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  }

  reset(): void {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.evictions = 0;
  }
}

// ─── RedisCache ───────────────────────────────────────────────────────────────

class RedisCache {
  private client: Redis | null = null;
  private enabled = false;

  async connect(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) return;

    try {
      this.client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 2000),
      });
      await this.client.connect();

      // Configure optimal eviction policy and memory limit
      const memoryLimit = process.env.REDIS_MEMORY_LIMIT ?? '256mb';
      await this.client.config('SET', 'maxmemory', memoryLimit);
      await this.client.config('SET', 'maxmemory-policy', 'allkeys-lru');

      this.enabled = true;
    } catch {
      this.client = null;
      this.enabled = false;
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client || !this.enabled) return null;
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    if (!this.client || !this.enabled) return;
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    try {
      await this.client.setex(key, ttlSec, JSON.stringify(value));
    } catch { /* non-fatal */ }
  }

  async invalidate(pattern: string): Promise<void> {
    if (!this.client || !this.enabled) return;
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) await this.client.del(...keys);
    } catch { /* non-fatal */ }
  }

  async invalidateAll(): Promise<void> {
    if (!this.client || !this.enabled) return;
    try {
      await this.client.flushdb();
    } catch { /* non-fatal */ }
  }

  /** Returns Redis memory usage and server-side hit ratio for monitoring. */
  async getMemoryInfo(): Promise<{ usedMemory: string; maxMemory: string; hitRatio: number } | null> {
    if (!this.client || !this.enabled) return null;
    try {
      const [memInfo, statsInfo] = await Promise.all([
        this.client.info('memory'),
        this.client.info('stats'),
      ]);
      const usedMemory = memInfo.match(/used_memory_human:(.+)/)?.[1]?.trim() ?? '?';
      const maxMemory = memInfo.match(/maxmemory_human:(.+)/)?.[1]?.trim() ?? '?';
      const hits = Number(statsInfo.match(/keyspace_hits:(\d+)/)?.[1] ?? 0);
      const misses = Number(statsInfo.match(/keyspace_misses:(\d+)/)?.[1] ?? 0);
      const hitRatio = hits + misses > 0 ? hits / (hits + misses) : 0;
      return { usedMemory, maxMemory, hitRatio };
    } catch {
      return null;
    }
  }
}

// ─── Shared instances ─────────────────────────────────────────────────────────

const memoryCache = new MemoryCache(2000);
const singleFlight = new SingleFlight();
const cacheMonitor = new CacheMonitor();
const redisCache = new RedisCache();

const CACHE_PREFIX = 'agenticpay:cache:';
const WARMED_KEYS = new Set<string>();
const DEFAULT_CACHE_BODY_LIMIT = 1_048_576; // 1 MiB

export function getCacheMonitor(): CacheMonitor {
  return cacheMonitor;
}

export function getMemoryCache(): MemoryCache {
  return memoryCache;
}

export function getSingleFlight(): SingleFlight {
  return singleFlight;
}

export function getRedisCache(): RedisCache {
  return redisCache;
}

// ─── Warming / invalidation ───────────────────────────────────────────────────

export function warmCache(key: string, fetchFn: () => Promise<unknown>, ttlMs: number): void {
  if (WARMED_KEYS.has(key)) return;
  WARMED_KEYS.add(key);
  fetchFn()
    .then((value) => {
      let etag = '';
      try {
        etag = computeETag(JSON.stringify(value));
      } catch {
        etag = '';
      }
      memoryCache.set(key, value, ttlMs, etag);
      redisCache.set(key, value, ttlMs).catch(() => {});
    })
    .catch(() => {
      WARMED_KEYS.delete(key);
    });
}

export function getWarmedKeys(): string[] {
  return Array.from(WARMED_KEYS);
}

/** Escape a glob pattern (`*`, `?`) into a RegExp for memory-key matching. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

/**
 * Invalidate cached responses whose cache key matches a glob pattern.
 * The pattern is relative to the internal `agenticpay:cache:` prefix,
 * e.g. `invalidateCache('GET:/api/catalog*')`.
 */
export async function invalidateCache(pattern: string): Promise<void> {
  const fullPattern = `${CACHE_PREFIX}${pattern}`;
  const re = globToRegExp(fullPattern);
  for (const key of memoryCache.keys()) {
    if (re.test(key)) {
      memoryCache.delete(key);
    }
  }
  await redisCache.invalidate(fullPattern);
}

/** Drop everything currently held in the in-memory cache. */
export function clearMemoryCache(): void {
  memoryCache.clear();
  WARMED_KEYS.clear();
}

// ─── Header / key helpers ─────────────────────────────────────────────────────

function buildCacheControlHeader(
  maxAge: number,
  isPublic: boolean,
  staleWhileRevalidate?: number,
): string {
  if (maxAge === 0) return 'no-store';

  const directives: string[] = [
    isPublic ? 'public' : 'private',
    `max-age=${maxAge}`,
  ];

  if (staleWhileRevalidate !== undefined && staleWhileRevalidate > 0) {
    directives.push(`stale-while-revalidate=${staleWhileRevalidate}`);
  }

  return directives.join(', ');
}

function computeETag(body: string): string {
  const hash = createHash('sha1').update(body).digest('hex').slice(0, 16);
  return `"${hash}"`;
}

function buildCacheKey(req: Request, customKey?: string): string {
  if (customKey) return `${CACHE_PREFIX}${customKey}`;
  return `${CACHE_PREFIX}${req.method}:${req.originalUrl}`;
}

function isCacheableMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

/**
 * Extract a single, quoted ETag from the current response writer's headers.
 * Returns '' when none has been set.
 */
function currentETag(res: Response): string {
  const header = res.getHeader('ETag');
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' ? value : '';
}

/** Reads the ETag of a stored response, or computes one for the given body. */
function etagFor(bodyStr: string, res: Response): string {
  return currentETag(res) || computeETag(bodyStr);
}

// ─── cacheControl middleware ──────────────────────────────────────────────────

export function cacheControl(options: CacheOptions) {
  const {
    maxAge,
    isPublic = true,
    staleWhileRevalidate,
    inMemory = false,
    cacheKey,
    maxBodySize = DEFAULT_CACHE_BODY_LIMIT,
  } = options;

  const cacheControlValue = buildCacheControlHeader(maxAge, isPublic, staleWhileRevalidate);
  const ttlMs = maxAge * 1000;

  return function cacheMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!isCacheableMethod(req.method)) {
      next();
      return;
    }

    // ── Header-only mode (no response caching) ─────────────────────────────
    if (!inMemory) {
      const originalJson = res.json.bind(res);
      res.json = function jsonWithCache(body: unknown): Response {
        res.json = originalJson;

        if (res.statusCode >= 400) {
          res.setHeader('Cache-Control', 'no-store');
          return originalJson(body);
        }

        const bodyStr = JSON.stringify(body);
        const etag = etagFor(bodyStr, res);

        res.setHeader('Cache-Control', cacheControlValue);
        res.setHeader('ETag', etag);

        if (clientHasFreshCopy(req, etag)) {
          res.status(304).end();
          return res;
        }

        return originalJson(body);
      };
      next();
      return;
    }

    // ── In-memory caching mode ─────────────────────────────────────────────
    const key = buildCacheKey(req, cacheKey);
    const entry = memoryCache.get<unknown>(key);

    if (entry && !entry.stale) {
      cacheMonitor.recordHit();
      serveFromCache(req, res, entry.etag, entry.value, cacheControlValue, 'HIT');
      return;
    }

    if (entry && entry.stale && (staleWhileRevalidate ?? 0) > 0) {
      cacheMonitor.recordHit();
      serveFromCache(req, res, entry.etag, entry.value, cacheControlValue, 'STALE');
      return;
    }

    cacheMonitor.recordMiss();

    const originalJson = res.json.bind(res);
    res.json = function jsonWithCacheAndStore(body: unknown): Response {
      res.json = originalJson;

      const statusCode = res.statusCode;
      const bodyStr = JSON.stringify(body);

      // Never cache or etag error responses
      if (statusCode >= 400) {
        res.setHeader('Cache-Control', 'no-store');
        return originalJson(body);
      }

      // Skip responses that exceed the configured body limit
      if (bodyStr.length > maxBodySize) {
        return originalJson(body);
      }

      const etag = etagFor(bodyStr, res);

      res.setHeader('Cache-Control', cacheControlValue);
      res.setHeader('ETag', etag);
      res.setHeader('X-Cache', 'MISS');

      // Store after the response has been fully written so interrupted
      // responses never poison the cache.
      res.on('finish', () => {
        memoryCache.set(key, body, ttlMs, etag);
        redisCache.set(key, body, ttlMs).catch(() => {});
        cacheMonitor.recordSet();
      });

      // Fast path: the client already holds this exact representation
      if (clientHasFreshCopy(req, etag)) {
        res.status(304).end();
        return res;
      }

      return originalJson(body);
    };

    next();
  };
}

/** True when the client's If-None-Match header matches the computed ETag. */
function clientHasFreshCopy(req: Request, etag: string): boolean {
  return parseIfNoneMatch(req.headers['if-none-match'] as string).some(
    (tag) => tag === '*' || weakMatch(tag, etag),
  );
}

/** Serve a previously stored response directly (no handler execution). */
function serveFromCache(
  req: Request,
  res: Response,
  etag: string,
  value: unknown,
  cacheControlValue: string,
  xCache: 'HIT' | 'STALE',
): void {
  res.setHeader('Cache-Control', cacheControlValue);
  res.setHeader('X-Cache', xCache);
  if (etag) res.setHeader('ETag', etag);

  if (etag && clientHasFreshCopy(req, etag)) {
    res.status(304).end();
    return;
  }

  res.json(value);
}

// ─── Periodic maintenance ─────────────────────────────────────────────────────

setInterval(() => {
  memoryCache.evictExpired();
}, 60_000).unref();