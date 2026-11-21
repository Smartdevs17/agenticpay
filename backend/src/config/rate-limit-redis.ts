import type { RedisClient } from '../middleware/rate-limit.js';

let sharedClientPromise: Promise<RedisClient | null> | null = null;

/**
 * Thin adapter over ioredis for atomic rate-limit counters.
 * Returns null when Redis is unavailable so callers can fall back to memory.
 */
export async function createRateLimitRedisClient(): Promise<RedisClient | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });

    await client.connect();
    return client as unknown as RedisClient;
  } catch (err) {
    console.warn('[RateLimit] Redis unavailable, using in-memory counters:', err);
    return null;
  }
}

export function getSharedRateLimitRedis(): Promise<RedisClient | null> {
  if (!sharedClientPromise) {
    sharedClientPromise = createRateLimitRedisClient();
  }
  return sharedClientPromise;
}

export default createRateLimitRedisClient;
