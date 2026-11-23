/**
 * Redis-based caching service with intelligent invalidation
 * Handles hot data caching, TTL management, event-driven invalidation,
 * cache warming, and performance metrics
 */

import { getRedisCache } from '../middleware/cache.js';
import { eventBus } from '../domains/event-bus.js';

export interface CacheConfig {
  defaultTtl: number; // seconds
  maxTtl: number; // seconds
  keyPrefix: string;
  warmOnStartup: boolean;
  metricsInterval: number; // seconds
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
  hitRate: number;
  avgSizeBytes: number;
}

export interface CacheWarmer {
  key: string;
  loader: () => Promise<any>;
  ttl: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  defaultTtl: 300, // 5 minutes
  maxTtl: 3600, // 1 hour
  keyPrefix: 'cache:',
  warmOnStartup: true,
  metricsInterval: 60, // 1 minute
};

class CacheService {
  private config: CacheConfig;
  private redis: ReturnType<typeof getRedisCache>;
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
    hitRate: 0,
    avgSizeBytes: 0,
  };
  private warmers: Map<string, CacheWarmer> = new Map();
  private invalidationRules: Map<string, string[]> = new Map(); // event -> cache keys to invalidate
  private inFlightLoads = new Map<string, Promise<unknown>>();
  private metricsInterval?: NodeJS.Timeout;

  constructor(config?: Partial<CacheConfig>, redis: ReturnType<typeof getRedisCache> = getRedisCache()) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.redis = redis;
  }

  /**
   * Initialize cache service
   */
  async initialize(): Promise<void> {
    // Setup invalidation rules
    this.setupInvalidationRules();

    // Warm cache on startup if enabled
    if (this.config.warmOnStartup) {
      await this.warmCache();
    }

    // Start metrics collection
    this.startMetricsCollection();
  }

  /**
   * Setup event-driven cache invalidation rules
   */
  private setupInvalidationRules(): void {
    // Payment-related invalidations
    this.invalidationRules.set('payment.created', ['payments:list', 'dashboard:overview']);
    this.invalidationRules.set('payment.updated', ['payments:list', 'dashboard:overview']);
    this.invalidationRules.set('payment.completed', ['payments:list', 'dashboard:overview', 'analytics:*']);

    // Invoice invalidations
    this.invalidationRules.set('invoice.created', ['invoices:list', 'dashboard:overview']);
    this.invalidationRules.set('invoice.updated', ['invoices:list', 'dashboard:overview']);
    this.invalidationRules.set('invoice.paid', ['invoices:list', 'dashboard:overview', 'analytics:*']);

    // User/project invalidations
    this.invalidationRules.set('user.updated', ['user:*', 'dashboard:*']);
    this.invalidationRules.set('project.updated', ['project:*', 'dashboard:*']);

    // Subscribe to events
    if (eventBus) {
      for (const [event] of this.invalidationRules) {
        eventBus.on(event, () => {
          const keys = this.invalidationRules.get(event) || [];
          this.invalidateKeys(keys).catch(console.error);
        });
      }
    }
  }

  /**
   * Read through Redis and coalesce concurrent cache misses for the same key.
   * The cache write is deliberately detached from the result path: a slow or
   * unavailable cache must not add its latency to the successful source read.
   */
  async get<T>(key: string, loader?: () => Promise<T>, ttl?: number): Promise<T | null> {
    const cacheKey = this.buildKey(key);

    try {
      const cached: unknown = await this.redis.get(cacheKey);
      if (cached !== null && cached !== undefined) {
        this.metrics.hits++;
        return (typeof cached === 'string' ? JSON.parse(cached) : cached) as T;
      }
    } catch (error) {
      // Cache failures are non-fatal; use the source loader when available.
      this.metrics.errors++;
      console.error(`[Cache] Error getting key ${cacheKey}:`, error);
    }

    this.metrics.misses++;
    if (!loader) return null;

    const inFlight = this.inFlightLoads.get(cacheKey);
    if (inFlight) return inFlight as Promise<T>;

    const loadPromise = (async () => {
      const value = await loader();
      if (value !== null && value !== undefined) {
        // set() owns cache-write error handling. Do not await it on the read path.
        void this.set(key, value, ttl);
      }
      return value;
    })().finally(() => {
      this.inFlightLoads.delete(cacheKey);
    });

    this.inFlightLoads.set(cacheKey, loadPromise);
    return loadPromise;
  }

  /**
   * Set value in cache
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const cacheKey = this.buildKey(key);
    const finalTtl = Math.min(ttl || this.config.defaultTtl, this.config.maxTtl);

    try {
      const serialized = JSON.stringify(value);
      this.metrics.sets++;

      // Track size
      this.metrics.avgSizeBytes = (this.metrics.avgSizeBytes + Buffer.byteLength(serialized)) / 2;

      if (finalTtl > 0) {
        await this.redis.setEx(cacheKey, finalTtl, serialized);
      } else {
        await this.redis.set(cacheKey, serialized);
      }
    } catch (error) {
      this.metrics.errors++;
      console.error(`[Cache] Error setting key ${cacheKey}:`, error);
    }
  }

  /**
   * Delete key from cache
   */
  async delete(key: string): Promise<void> {
    const cacheKey = this.buildKey(key);

    try {
      await this.redis.del(cacheKey);
      this.metrics.deletes++;
    } catch (error) {
      this.metrics.errors++;
      console.error(`[Cache] Error deleting key ${cacheKey}:`, error);
    }
  }

  /**
   * Invalidate keys matching pattern (supports wildcards)
   */
  async invalidateKeys(patterns: string[]): Promise<void> {
    try {
      for (const pattern of patterns) {
        const scanPattern = this.buildKey(pattern);

        // Use SCAN to avoid blocking
        let cursor = 0;
        do {
          const result = await this.redis.scan(cursor, { MATCH: scanPattern });
          cursor = result.cursor;

          if (result.keys.length > 0) {
            await this.redis.del(result.keys);
            this.metrics.deletes += result.keys.length;
          }
        } while (cursor !== 0);
      }
    } catch (error) {
      this.metrics.errors++;
      console.error('[Cache] Error invalidating patterns:', error);
    }
  }

  /**
   * Register cache warmer for critical data
   */
  registerWarmer(key: string, loader: () => Promise<any>, ttl: number): void {
    this.warmers.set(key, { key, loader, ttl });
  }

  /**
   * Warm cache with critical data
   */
  private async warmCache(): Promise<void> {
    console.log(`[Cache] Warming cache with ${this.warmers.size} items...`);

    const warmingPromises = Array.from(this.warmers.values()).map(async (warmer) => {
      try {
        const value = await warmer.loader();
        await this.set(warmer.key, value, warmer.ttl);
        console.log(`[Cache] Warmed key: ${warmer.key}`);
      } catch (error) {
        console.error(`[Cache] Failed to warm key ${warmer.key}:`, error);
      }
    });

    await Promise.all(warmingPromises);
  }

  /**
   * Build cache key with prefix
   */
  private buildKey(key: string): string {
    return `${this.config.keyPrefix}${key}`;
  }

  /**
   * Get current cache metrics
   */
  getMetrics(): CacheMetrics {
    const total = this.metrics.hits + this.metrics.misses;
    return {
      ...this.metrics,
      hitRate: total > 0 ? (this.metrics.hits / total) * 100 : 0,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      hitRate: 0,
      avgSizeBytes: 0,
    };
  }

  /**
   * Start periodic metrics reporting
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      const metrics = this.getMetrics();
      console.log(`[Cache Metrics] Hits: ${metrics.hits}, Misses: ${metrics.misses}, Hit Rate: ${metrics.hitRate.toFixed(2)}%, Errors: ${metrics.errors}`);
    }, this.config.metricsInterval * 1000);
  }

  /**
   * Shutdown cache service
   */
  async shutdown(): Promise<void> {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
}

// Singleton instance
let cacheServiceInstance: CacheService | null = null;

export async function getCacheService(config?: Partial<CacheConfig>): Promise<CacheService> {
  if (!cacheServiceInstance) {
    cacheServiceInstance = new CacheService(config);
    await cacheServiceInstance.initialize();
  }
  return cacheServiceInstance;
}

export { CacheService };

// Export singleton for easy access
export const cacheService = getCacheService();
