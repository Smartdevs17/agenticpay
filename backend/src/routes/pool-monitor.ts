/**
 * Database Connection Pool Monitoring Routes
 * Exposes pool health, metrics, and configuration endpoints
 */

import express, { Router, Request, Response } from 'express';
import { getPoolMonitor } from '../services/pool-monitor.js';
import { getCompressionMetrics } from '../middleware/compression.js';
import { getCacheService } from '../services/cache.js';
import { poolMetrics, getPgBouncerConfig } from '../config/database.js';

export const poolMonitorRouter = Router();

/**
 * GET /api/v1/monitoring/pool/health
 * Get comprehensive pool health report
 */
poolMonitorRouter.get('/health', async (req: Request, res: Response) => {
  try {
    const monitor = getPoolMonitor();
    const health = monitor.getHealthReport();

    res.set('Cache-Control', 'public, max-age=10');
    res.json({
      status: health.status,
      timestamp: new Date().toISOString(),
      data: health,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get pool health' });
  }
});

/**
 * GET /api/v1/monitoring/pool/metrics
 * Get detailed pool metrics
 */
poolMonitorRouter.get('/metrics', async (req: Request, res: Response) => {
  try {
    const monitor = getPoolMonitor();
    const metrics = monitor.getMetrics();

    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      timestamp: new Date().toISOString(),
      data: metrics,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get pool metrics' });
  }
});

/**
 * GET /api/v1/monitoring/pool/config
 * Get PgBouncer configuration
 */
poolMonitorRouter.get('/config', async (req: Request, res: Response) => {
  try {
    const config = getPgBouncerConfig();

    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      timestamp: new Date().toISOString(),
      data: config,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get pool config' });
  }
});

/**
 * GET /api/v1/monitoring/compression
 * Get compression metrics
 */
poolMonitorRouter.get('/compression', async (req: Request, res: Response) => {
  try {
    const metrics = getCompressionMetrics();

    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      timestamp: new Date().toISOString(),
      data: metrics,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get compression metrics' });
  }
});

/**
 * GET /api/v1/monitoring/cache
 * Get cache service metrics
 */
poolMonitorRouter.get('/cache', async (req: Request, res: Response) => {
  try {
    const cache = await getCacheService();
    const metrics = cache.getMetrics();

    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      timestamp: new Date().toISOString(),
      data: metrics,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get cache metrics' });
  }
});

/**
 * POST /api/v1/monitoring/cache/reset-metrics
 * Reset cache metrics (admin only)
 */
poolMonitorRouter.post('/cache/reset-metrics', async (req: Request, res: Response) => {
  try {
    const cache = await getCacheService();
    cache.resetMetrics();

    res.json({
      success: true,
      message: 'Cache metrics reset',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset cache metrics' });
  }
});

/**
 * GET /api/v1/monitoring/performance
 * Get combined performance metrics (all systems)
 */
poolMonitorRouter.get('/performance', async (req: Request, res: Response) => {
  try {
    const monitor = getPoolMonitor();
    const poolHealth = monitor.getHealthReport();
    const poolMetricsData = monitor.getMetrics();
    const compressionMetrics = getCompressionMetrics();
    const cache = await getCacheService();
    const cacheMetrics = cache.getMetrics();

    const performanceScore =
      (100 - Math.min(poolHealth.utilizationPercent, 100)) * 0.3 +
      Math.min(cacheMetrics.hitRate, 100) * 0.3 +
      (100 - Math.min(compressionMetrics.compressionRatio || 0, 100)) * 0.2 +
      (100 - Math.min(poolMetricsData.connectionLeaseErrors, 100)) * 0.2;

    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      timestamp: new Date().toISOString(),
      performanceScore: Math.round(performanceScore * 10) / 10,
      data: {
        pool: {
          health: poolHealth,
          metrics: poolMetricsData,
        },
        compression: compressionMetrics,
        cache: cacheMetrics,
      },
      recommendations: poolHealth.recommendations,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get performance metrics' });
  }
});

/**
 * GET /api/v1/monitoring/leaks
 * Detect connection leaks
 */
poolMonitorRouter.get('/leaks', async (req: Request, res: Response) => {
  try {
    const monitor = getPoolMonitor();
    const leakCount = await monitor.detectLeaks();
    const health = monitor.getHealthReport();

    res.set('Cache-Control', 'public, max-age=10');
    res.json({
      timestamp: new Date().toISOString(),
      data: {
        detectedLeaks: leakCount,
        leakStatus: health.leaks,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to detect leaks' });
  }
});

export default poolMonitorRouter;
