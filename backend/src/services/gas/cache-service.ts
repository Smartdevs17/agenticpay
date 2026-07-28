/**
 * Gas estimate caching service with Redis and TTL-based invalidation
 * 
 * Provides a high-performance cache layer for gas estimates to reduce
 * computational overhead and provide consistent responses for frequently
 * accessed estimates.
 */

import { Redis } from 'ioredis';

export interface GasEstimateCacheKey {
  chainId: number;
  operation: string;
  itemCount?: number;
  calldataBytes?: number;
}

export interface CachedGasEstimate {
  estimate: any;
  fees?: any;
  timestamp: number;
  ttl: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalKeys: number;
}

export class GasEstimateCache {
  private redis: Redis;
  private stats: Map<string, { hits: number; misses: number }> = new Map();
  private defaultTTL: number = 60; // 60 seconds default
  private keyPrefix: string = 'gas:estimate:';

  constructor(redisClient: Redis, defaultTTL: number = 60) {
    this.redis = redisClient;
    this.defaultTTL = defaultTTL;
  }

  /**
   * Generate cache key from estimate parameters
   */
  private generateKey(params: GasEstimateCacheKey): string {
    const { chainId, operation, itemCount = 0, calldataBytes = 0 } = params;
    return `${this.keyPrefix}${chainId}:${operation}:${itemCount}:${calldataBytes}`;
  }

  /**
   * Get cached gas estimate
   */
  async get(params: GasEstimateCacheKey): Promise<CachedGasEstimate | null> {
    const key = this.generateKey(params);
    const statKey = key;

    try {
      const cached = await this.redis.get(key);
      
      if (cached) {
        const data: CachedGasEstimate = JSON.parse(cached);
        
        // Check if cache entry is still valid
        if (Date.now() < data.timestamp + data.ttl * 1000) {
          this.updateStats(statKey, 'hit');
          return data;
        } else {
          // Expired, delete it
          await this.redis.del(key);
        }
      }
      
      this.updateStats(statKey, 'miss');
      return null;
    } catch (error) {
      console.error('Cache get error:', error);
      this.updateStats(statKey, 'miss');
      return null;
    }
  }

  /**
   * Set gas estimate in cache with TTL
   */
  async set(params: GasEstimateCacheKey, estimate: any, fees?: any, ttl?: number): Promise<void> {
    const key = this.generateKey(params);
    const cacheTTL = ttl ?? this.defaultTTL;

    const data: CachedGasEstimate = {
      estimate,
      fees,
      timestamp: Date.now(),
      ttl: cacheTTL,
    };

    try {
      await this.redis.setex(key, cacheTTL, JSON.stringify(data));
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  /**
   * Invalidate cache for specific parameters
   */
  async invalidate(params: GasEstimateCacheKey): Promise<void> {
    const key = this.generateKey(params);
    await this.redis.del(key);
  }

  /**
   * Invalidate all cache entries for a chain
   */
  async invalidateChain(chainId: number): Promise<void> {
    const pattern = `${this.keyPrefix}${chainId}:*`;
    const keys = await this.redis.keys(pattern);
    
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  /**
   * Invalidate all cache entries for an operation
   */
  async invalidateOperation(operation: string): Promise<void> {
    const pattern = `${this.keyPrefix}*:${operation}:*`;
    const keys = await this.redis.keys(pattern);
    
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  /**
   * Clear all gas estimate cache
   */
  async clear(): Promise<void> {
    const pattern = `${this.keyPrefix}*`;
    const keys = await this.redis.keys(pattern);
    
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    
    this.stats.clear();
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    const pattern = `${this.keyPrefix}*`;
    const keys = await this.redis.keys(pattern);
    
    let totalHits = 0;
    let totalMisses = 0;
    
    for (const [, stat] of this.stats.entries()) {
      totalHits += stat.hits;
      totalMisses += stat.misses;
    }
    
    const totalRequests = totalHits + totalMisses;
    const hitRate = totalRequests > 0 ? totalHits / totalRequests : 0;
    
    return {
      hits: totalHits,
      misses: totalMisses,
      hitRate,
      totalKeys: keys.length,
    };
  }

  /**
   * Update cache statistics
   */
  private updateStats(key: string, type: 'hit' | 'miss'): void {
    if (!this.stats.has(key)) {
      this.stats.set(key, { hits: 0, misses: 0 });
    }
    
    const stat = this.stats.get(key)!;
    if (type === 'hit') {
      stat.hits++;
    } else {
      stat.misses++;
    }
  }

  /**
   * Warm up cache with common estimates
   */
  async warmup(commonEstimates: Array<{ params: GasEstimateCacheKey; estimate: any; fees?: any }>): Promise<void> {
    const operations = commonEstimates.map(({ params, estimate, fees }) =>
      this.set(params, estimate, fees)
    );
    
    await Promise.all(operations);
  }

  /**
   * Get cache keys matching a pattern
   */
  async getKeys(pattern?: string): Promise<string[]> {
    const searchPattern = pattern ?? `${this.keyPrefix}*`;
    return this.redis.keys(searchPattern);
  }

  /**
   * Get cache entry without updating stats
   */
  async peek(params: GasEstimateCacheKey): Promise<CachedGasEstimate | null> {
    const key = this.generateKey(params);
    
    try {
      const cached = await this.redis.get(key);
      
      if (cached) {
        const data: CachedGasEstimate = JSON.parse(cached);
        
        if (Date.now() < data.timestamp + data.ttl * 1000) {
          return data;
        }
      }
      
      return null;
    } catch (error) {
      console.error('Cache peek error:', error);
      return null;
    }
  }

  /**
   * Set custom TTL for a specific cache entry
   */
  async setTTL(params: GasEstimateCacheKey, ttl: number): Promise<boolean> {
    const key = this.generateKey(params);
    
    try {
      const result = await this.redis.expire(key, ttl);
      return result === 1;
    } catch (error) {
      console.error('Cache setTTL error:', error);
      return false;
    }
  }

  /**
   * Get remaining TTL for a cache entry
   */
  async getTTL(params: GasEstimateCacheKey): Promise<number> {
    const key = this.generateKey(params);
    
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      console.error('Cache getTTL error:', error);
      return -1;
    }
  }
}

// Singleton instance
let gasEstimateCacheInstance: GasEstimateCache | null = null;

export function getGasEstimateCache(redisClient?: Redis): GasEstimateCache {
  if (!gasEstimateCacheInstance && redisClient) {
    gasEstimateCacheInstance = new GasEstimateCache(redisClient);
  }
  
  if (!gasEstimateCacheInstance) {
    throw new Error('GasEstimateCache not initialized. Provide a Redis client.');
  }
  
  return gasEstimateCacheInstance;
}

export function initGasEstimateCache(redisClient: Redis, defaultTTL?: number): GasEstimateCache {
  gasEstimateCacheInstance = new GasEstimateCache(redisClient, defaultTTL);
  return gasEstimateCacheInstance;
}
