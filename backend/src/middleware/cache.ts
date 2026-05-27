import { createHash, randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

export interface CacheOptions {
  maxAge: number;
  isPublic?: boolean;
  staleWhileRevalidate?: number;
  inMemory?: boolean;
  cacheKey?: string;
}

export const CacheTTL = {
  STATIC: 300,
  SHORT: 30,
  IMMUTABLE: 600,
  NONE: 0,
} as const;

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
  createdAt: number;
  hitCount: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  get<T>(key: string): { value: T; stale: boolean } | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    entry.hitCount++;
    const stale = Date.now() > entry.expiresAt;
    return { value: entry.value as T, stale };
  }

  set(key: string, value: unknown, ttlMs: number): void {
    if (this.store.size >= this.maxSize) {
      const oldest = this.store.entries().next().value;
      if (oldest) this.store.delete(oldest[0]);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
      hitCount: 0,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
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

  get inFlightCount(): number {
    return this.inFlight.size;
  }
}

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

class RedisCache {
  private enabled = false;

  async connect(): Promise<void> {
    try {
      const env = process.env.REDIS_URL || process.env.REDIS_ENABLED;
      if (env) {
        this.enabled = true;
      }
    } catch {
      this.enabled = false;
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.enabled) return null;
    return null;
  }

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
  }

  async invalidate(pattern: string): Promise<void> {
    if (!this.enabled) return;
  }

  async invalidateAll(): Promise<void> {
    if (!this.enabled) return;
  }
}

const memoryCache = new MemoryCache(2000);
const singleFlight = new SingleFlight();
const cacheMonitor = new CacheMonitor();
const redisCache = new RedisCache();

const CACHE_PREFIX = 'agenticpay:cache:';
const WARMED_KEYS = new Set<string>();

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

export function warmCache(key: string, fetchFn: () => Promise<unknown>, ttlMs: number): void {
  if (WARMED_KEYS.has(key)) return;
  WARMED_KEYS.add(key);
  fetchFn().then((value) => {
    memoryCache.set(key, value, ttlMs);
    redisCache.set(key, value, ttlMs);
  }).catch(() => {
    WARMED_KEYS.delete(key);
  });
}

export function getWarmedKeys(): string[] {
  return Array.from(WARMED_KEYS);
}

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

export function cacheControl(options: CacheOptions) {
  const { maxAge, isPublic = true, staleWhileRevalidate, inMemory = false, cacheKey } = options;

  const cacheControlValue = buildCacheControlHeader(maxAge, isPublic, staleWhileRevalidate);
  const ttlMs = maxAge * 1000;

  return function cacheMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    if (inMemory) {
      const key = buildCacheKey(req, cacheKey);

      const cached = memoryCache.get<unknown>(key);
      if (cached) {
        if (!cached.stale) {
          cacheMonitor.recordHit();
          res.setHeader('X-Cache', 'HIT');
          res.setHeader('Cache-Control', cacheControlValue);
          return res.json(cached.value);
        }
      }

      cacheMonitor.recordMiss();

      singleFlight.execute(key, async () => {
        const originalJson = res.json.bind(res);
        let capturedBody: unknown;

        res.json = function jsonWithCache(body: unknown): Response {
          res.json = originalJson;
          capturedBody = body;

          const bodyStr = JSON.stringify(body);
          const etag = computeETag(bodyStr);

          res.setHeader('Cache-Control', cacheControlValue);
          res.setHeader('ETag', etag);
          res.setHeader('X-Cache', 'MISS');

          memoryCache.set(key, body, ttlMs);
          redisCache.set(key, body, ttlMs);
          cacheMonitor.recordSet();

          const clientETag = req.headers['if-none-match'];
          if (clientETag && clientETag === etag) {
            res.status(304).end();
            return res;
          }

          return originalJson(body);
        };

        next();
        await new Promise<void>((resolve) => {
          res.on('finish', () => resolve());
        });
        return capturedBody;
      }).catch(() => {});
      return;
    }

    const originalJson = res.json.bind(res);

    res.json = function jsonWithCache(body: unknown): Response {
      res.json = originalJson;

      const bodyStr = JSON.stringify(body);
      const etag = computeETag(bodyStr);

      res.setHeader('Cache-Control', cacheControlValue);
      res.setHeader('ETag', etag);

      const clientETag = req.headers['if-none-match'];
      if (clientETag && clientETag === etag) {
        res.status(304).end();
        return res;
      }

      return originalJson(body);
    };

    next();
  };
}

setInterval(() => {
  memoryCache.evictExpired();
}, 60_000);
