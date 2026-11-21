/**
 * backend/src/services/analytics-cache.ts
 *
 * Partition-aware analytics rollup cache with single-flight stampede protection,
 * bounded LRU memory, fail-open semantics, and write-path invalidation (Issue #1458).
 *
 * Concepts:
 * - "Partition": time bucket (e.g. day `YYYY-MM-DD` or hour `YYYY-MM-DDTHH:00:00Z`) scoped to a tenant.
 * - Closed partition: past immutable historical bucket -> Long TTL (default 24 hours / 86400s).
 * - Open partition: current ongoing time bucket -> Short TTL (default 60s) + invalidation on write.
 * - Single-flight: concurrent requests for the same key coalesce into a single execution; failures are not cached.
 * - Fail-open: Redis/store errors never fail the query; the service falls back to direct source computation.
 */

import { createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { config as getConfig } from '../config/env.js';

export interface AnalyticsCacheOptions {
  tenantId: string;
  metric: string;
  partitionDate?: Date | string;
  filters?: Record<string, unknown>;
  ttlSeconds?: number;
}

export interface AnalyticsCacheMetrics {
  hits: number;
  misses: number;
  stale: number;
  invalidations: number;
  errors: number;
  computations: number;
  size: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  partition: string;
  tenantId: string;
  metric: string;
}

export class BoundedLRUCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(private readonly maxEntries: number = 2000) {}

  get(key: string): { value: T; stale: boolean } | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    // Move to end to mark as recently used (LRU)
    this.store.delete(key);
    this.store.set(key, entry);

    const stale = Date.now() > entry.expiresAt;
    return { value: entry.value, stale };
  }

  set(key: string, entry: CacheEntry<T>): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      // Evict oldest entry (first item in Map iterator)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, entry);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  findKeys(predicate: (key: string, entry: CacheEntry<T>) => boolean): string[] {
    const matched: string[] = [];
    for (const [k, v] of this.store.entries()) {
      if (predicate(k, v)) {
        matched.push(k);
      }
    }
    return matched;
  }
}

export class AnalyticsRollupCache {
  private lru: BoundedLRUCache<any>;
  private inFlight = new Map<string, Promise<any>>();
  private metrics: AnalyticsCacheMetrics = {
    hits: 0,
    misses: 0,
    stale: 0,
    invalidations: 0,
    errors: 0,
    computations: 0,
    size: 0,
  };

  private redisClient: any = null;

  constructor(
    private options?: {
      enabled?: boolean;
      openTtlSeconds?: number;
      closedTtlSeconds?: number;
      maxEntries?: number;
      schemaVersion?: number;
      redisClient?: any;
    },
  ) {
    const maxEntries = options?.maxEntries ?? 2000;
    this.lru = new BoundedLRUCache(maxEntries);
    this.redisClient = options?.redisClient ?? null;
  }

  private get isEnabled(): boolean {
    if (this.options?.enabled !== undefined) {
      return this.options.enabled;
    }
    try {
      const env = getConfig();
      return (env as any).ANALYTICS_CACHE_ENABLED !== false;
    } catch {
      return true;
    }
  }

  private get openTtlSeconds(): number {
    return this.options?.openTtlSeconds ?? 60;
  }

  private get closedTtlSeconds(): number {
    return this.options?.closedTtlSeconds ?? 86400; // 24 hours
  }

  private get schemaVersion(): number {
    return this.options?.schemaVersion ?? 1;
  }

  /**
   * Determine partition bucket key and whether it represents an open (current)
   * or closed (historical) partition.
   */
  classifyPartition(partitionDate?: Date | string, referenceNow = new Date()): {
    partition: string;
    isOpen: boolean;
    ttlSeconds: number;
  } {
    const target = partitionDate ? new Date(partitionDate) : referenceNow;
    const y = target.getUTCFullYear();
    const m = String(target.getUTCMonth() + 1).padStart(2, '0');
    const d = String(target.getUTCDate()).padStart(2, '0');
    const partition = `${y}-${m}-${d}`;

    const curY = referenceNow.getUTCFullYear();
    const curM = String(referenceNow.getUTCMonth() + 1).padStart(2, '0');
    const curD = String(referenceNow.getUTCDate()).padStart(2, '0');
    const currentPartition = `${curY}-${curM}-${curD}`;

    const isOpen = partition >= currentPartition;
    const ttlSeconds = isOpen ? this.openTtlSeconds : this.closedTtlSeconds;

    return { partition, isOpen, ttlSeconds };
  }

  /**
   * Construct a deterministic, tenant-isolated cache key.
   * Format: `analytics:rollup:v{v}:{tenantId}:{metric}:{partition}:{filterHash}`
   */
  buildKey(opts: AnalyticsCacheOptions, referenceNow = new Date()): { key: string; partition: string; isOpen: boolean; ttlSeconds: number } {
    const { tenantId, metric, partitionDate, filters } = opts;
    const { partition, isOpen, ttlSeconds } = this.classifyPartition(partitionDate, referenceNow);

    const filterStr = filters ? JSON.stringify(filters, Object.keys(filters).sort()) : '';
    const filterHash = createHash('sha256').update(filterStr).digest('hex').slice(0, 12);

    const key = `analytics:rollup:v${this.schemaVersion}:${tenantId}:${metric}:${partition}:${filterHash}`;
    return { key, partition, isOpen, ttlSeconds: opts.ttlSeconds ?? ttlSeconds };
  }

  /**
   * Fetch a rollup through the cache with stampede single-flight, fail-open
   * fallback to `loader`, and metric updates.
   */
  async getOrCompute<T>(
    opts: AnalyticsCacheOptions,
    loader: () => Promise<T>,
    referenceNow = new Date(),
  ): Promise<T> {
    if (!this.isEnabled) {
      this.metrics.computations++;
      return loader();
    }

    const { key, partition, isOpen, ttlSeconds } = this.buildKey(opts, referenceNow);

    // 1. Try reading from in-memory LRU
    try {
      const cached = this.lru.get(key);
      if (cached) {
        if (!cached.stale) {
          this.metrics.hits++;
          logger.info(`[AnalyticsCache] HIT key=${key} partition=${partition} open=${isOpen}`);
          return cached.value as T;
        }
        this.metrics.stale++;
      }
    } catch (err) {
      this.metrics.errors++;
      logger.warn(`[AnalyticsCache] LRU read error: ${err}`);
    }

    // 2. Try reading from Redis if available
    if (this.redisClient) {
      try {
        const raw = await this.redisClient.get(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          this.metrics.hits++;
          this.lru.set(key, {
            value: parsed,
            expiresAt: Date.now() + ttlSeconds * 1000,
            createdAt: Date.now(),
            partition,
            tenantId: opts.tenantId,
            metric: opts.metric,
          });
          return parsed as T;
        }
      } catch (err) {
        this.metrics.errors++;
        logger.warn(`[AnalyticsCache] Redis read error: ${err}`);
      }
    }

    this.metrics.misses++;
    logger.info(`[AnalyticsCache] MISS key=${key} partition=${partition} open=${isOpen}`);

    // 3. Single-Flight Stampede Protection
    let flightPromise = this.inFlight.get(key);
    if (!flightPromise) {
      flightPromise = (async () => {
        try {
          this.metrics.computations++;
          const computed = await loader();

          // Store in LRU
          const expiresAt = Date.now() + ttlSeconds * 1000;
          this.lru.set(key, {
            value: computed,
            expiresAt,
            createdAt: Date.now(),
            partition,
            tenantId: opts.tenantId,
            metric: opts.metric,
          });
          this.metrics.size = this.lru.size;

          // Store in Redis if available
          if (this.redisClient) {
            try {
              await this.redisClient.set(key, JSON.stringify(computed), 'EX', ttlSeconds);
            } catch (err) {
              this.metrics.errors++;
              logger.warn(`[AnalyticsCache] Redis set error: ${err}`);
            }
          }

          return computed;
        } finally {
          this.inFlight.delete(key);
        }
      })();

      this.inFlight.set(key, flightPromise);
    }

    try {
      return await flightPromise;
    } catch (computeErr) {
      // Single-flight failed: computation was not cached. Re-throw to caller.
      throw computeErr;
    }
  }

  /**
   * Narrow invalidation function called from write paths (payments, refunds,
   * disputes, adjustments).
   */
  async invalidate(params: {
    tenantId: string;
    partitionDate?: Date | string;
    metric?: string;
  }): Promise<number> {
    try {
      const { tenantId, partitionDate, metric } = params;
      const { partition } = this.classifyPartition(partitionDate);

      // Find all matching keys in LRU
      const matchedKeys = this.lru.findKeys((_k, entry) => {
        if (entry.tenantId !== tenantId) return false;
        if (metric && entry.metric !== metric) return false;
        // Invalidate the exact partition or any open partition entry
        return entry.partition === partition;
      });

      for (const k of matchedKeys) {
        this.lru.delete(k);
      }

      // Also invalidate in Redis if configured
      if (this.redisClient && matchedKeys.length > 0) {
        try {
          await this.redisClient.del(...matchedKeys);
        } catch (err) {
          this.metrics.errors++;
          logger.warn(`[AnalyticsCache] Redis del error: ${err}`);
        }
      }

      this.metrics.invalidations += matchedKeys.length;
      this.metrics.size = this.lru.size;

      logger.info(
        `[AnalyticsCache] INVALIDATE tenantId=${tenantId} partition=${partition} invalidatedCount=${matchedKeys.length}`,
      );

      return matchedKeys.length;
    } catch (err) {
      this.metrics.errors++;
      logger.error(`[AnalyticsCache] Invalidation error: ${err}`);
      return 0;
    }
  }

  getMetrics(): AnalyticsCacheMetrics {
    return { ...this.metrics, size: this.lru.size };
  }

  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      stale: 0,
      invalidations: 0,
      errors: 0,
      computations: 0,
      size: 0,
    };
    this.lru.clear();
    this.inFlight.clear();
  }
}

export const analyticsRollupCache = new AnalyticsRollupCache();

/**
 * Global invalidation hook for write paths (payments, refunds, disputes).
 */
export async function invalidateAnalyticsRollups(params: {
  tenantId: string;
  timestamp?: Date | string;
  metric?: string;
}): Promise<number> {
  return analyticsRollupCache.invalidate({
    tenantId: params.tenantId,
    partitionDate: params.timestamp,
    metric: params.metric,
  });
}
