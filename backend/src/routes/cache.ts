import { Router } from 'express';
import {
  getCacheMonitor,
  getMemoryCache,
  getSingleFlight,
  getRedisCache,
  getWarmedKeys,
} from '../middleware/cache.js';

export const cacheRouter = Router();

cacheRouter.get('/stats', (_req, res) => {
  const monitor = getCacheMonitor();
  const memCache = getMemoryCache();
  const sf = getSingleFlight();
  const redis = getRedisCache();

  return res.json({
    monitor: monitor.getStats(),
    hitRatio: monitor.hitRatio,
    memoryCache: memCache.getStats(),
    singleFlight: { inFlightCount: sf.inFlightCount },
    redis: { enabled: redis.isEnabled },
    warmedKeys: getWarmedKeys(),
  });
});

cacheRouter.post('/clear', (_req, res) => {
  getMemoryCache().clear();
  getRedisCache().invalidateAll().catch(() => {});
  getCacheMonitor().reset();
  return res.json({ message: 'Cache cleared' });
});

cacheRouter.post('/evict', (_req, res) => {
  const evicted = getMemoryCache().evictExpired();
  return res.json({ evicted });
});
