/**
 * backend/src/routes/database.ts
 *
 * Exposes database monitoring endpoints consumed by the frontend dashboard
 * at /dashboard/database.
 *
 * Routes:
 *   GET  /api/v1/database/stats          — Query profiler + middleware stats
 *   GET  /api/v1/database/index-stats     — pg_stat_user_indexes snapshot
 *   GET  /api/v1/database/index-recommendations — Index recommendations
 *   GET  /api/v1/database/query-plans     — EXPLAIN ANALYZE for hot queries
 *   GET  /api/v1/database/alerts          — Database performance alerts
 *   GET  /api/v1/database/table-scans     — pg_stat_user_tables snapshot
 */

import { Router, Request, Response } from 'express';
import {
  queryProfiler,
  indexRecommendationEngine,
  dbAlertManager,
  getQueryProfiler,
} from '../config/database.js';
import { getSlowQueryDashboard, resetQueryMetrics } from '../middleware/queryLogger.js';
import { poolMetrics, connectionLeaseManager, poolExhaustionManager } from '../config/database.js';

const router = Router();

router.get('/stats', async (_req: Request, res: Response) => {
  const dashboard = getSlowQueryDashboard();
  const poolMetricsSnapshot = poolMetrics.snapshot();
  res.json({
    data: {
      ...dashboard,
      pool: {
        ...poolMetricsSnapshot,
        activeLeases: connectionLeaseManager.getActiveLeaseCount(),
        isExhausted: poolExhaustionManager.isPoolExhausted(),
        backoffMs: poolExhaustionManager.getBackoffMs(),
      },
    },
  });
});

router.get('/index-stats', async (_req: Request, res: Response) => {
  try {
    const stats = await indexRecommendationEngine.getIndexUsageStats();
    res.json({ data: stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch index stats', details: String(err) });
  }
});

router.get('/index-recommendations', async (_req: Request, res: Response) => {
  try {
    const recommendations = await indexRecommendationEngine.recommendIndexes();
    res.json({ data: recommendations });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate recommendations', details: String(err) });
  }
});

router.get('/query-plans', async (_req: Request, res: Response) => {
  try {
    const plans = await indexRecommendationEngine.getQueryPlans();
    res.json({ data: plans });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch query plans', details: String(err) });
  }
});

router.get('/alerts', async (_req: Request, res: Response) => {
  const severity = _req.query.severity as string | undefined;
  const alerts = severity
    ? dbAlertManager.getAlerts(severity as 'info' | 'warn' | 'critical')
    : dbAlertManager.getAlerts();
  res.json({ data: alerts });
});

router.get('/table-scans', async (_req: Request, res: Response) => {
  try {
    const stats = await indexRecommendationEngine.getTableScanStats();
    res.json({ data: stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch table scan stats', details: String(err) });
  }
});

router.post('/metrics/reset', async (_req: Request, res: Response) => {
  queryProfiler.reset();
  resetQueryMetrics();
  res.json({ data: { message: 'Query metrics reset' } });
});

export { router as databaseRouter };