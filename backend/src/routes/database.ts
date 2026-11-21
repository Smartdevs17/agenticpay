/**
 * backend/src/routes/database.ts
 *
 * Exposes database monitoring endpoints consumed by the frontend dashboard
 * at /dashboard/database.
 *
 * Routes:
 *   GET  /api/v1/database/stats               — Query profiler + middleware stats
 *   GET  /api/v1/database/index-stats          — pg_stat_user_indexes snapshot
 *   GET  /api/v1/database/index-recommendations— Index recommendations
 *   GET  /api/v1/database/query-plans          — EXPLAIN ANALYZE for hot queries
 *   GET  /api/v1/database/alerts               — Database performance alerts
 *   GET  /api/v1/database/table-scans          — pg_stat_user_tables snapshot
 *   POST /api/v1/database/analyse-queries      — Index recommendations from observed SQL
 *
 *   — Read-replica routing (Issue #881) ——————————————————————————————————————
 *   GET  /api/v1/database/replicas             — List replica health + routing stats
 *   POST /api/v1/database/replicas/:url/disable— Disable a specific replica
 *   POST /api/v1/database/replicas/:url/enable — Re-enable a specific replica
 */

import { Router, Request, Response } from 'express';
import {
  queryProfiler,
  indexRecommendationEngine,
  dbAlertManager,
  getQueryProfiler,
  readReplicaRouter,
} from '../config/database.js';
import { getSlowQueryDashboard, resetQueryMetrics } from '../middleware/queryLogger.js';
import { poolMetrics, connectionLeaseManager, poolExhaustionManager } from '../config/database.js';
import { z } from 'zod';
import {
  analyseQuery,
  recommendIndexes,
  detectFullTableScans,
  consolidateByTable,
  type QueryStats,
} from '../services/query-optimization.js';
import { validateRequest } from '../middleware/validate.js';

const router = Router();

const analyseQuerySchema = z.object({
  queries: z
    .array(
      z.object({
        sql: z.string().min(1),
        executions: z.number().int().nonnegative().optional(),
        avgDurationMs: z.number().nonnegative().optional(),
        rowsExamined: z.number().nonnegative().optional(),
      }),
    )
    .min(1, 'At least one query is required'),
});

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

/**
 * POST /database/analyse-queries
 *
 * Analyses a batch of observed SQL statements and returns index
 * recommendations plus any statements flagged as likely full-table scans.
 * Backs the index-analysis workflow for Issue #739.
 */
router.post(
  '/analyse-queries',
  validateRequest({ body: analyseQuerySchema }),
  (req: Request, res: Response) => {
    const stats = (req.body.queries as Array<{
      sql: string;
      executions?: number;
      avgDurationMs?: number;
      rowsExamined?: number;
    }>)
      .map((entry) => analyseQuery(entry.sql, entry))
      .filter((s): s is QueryStats => s !== null);

    const recommendations = recommendIndexes(stats);
    res.json({
      data: {
        analysed: stats.length,
        recommendations,
        byTable: consolidateByTable(recommendations),
        fullTableScans: detectFullTableScans(stats),
      },
    });
  },
);

// ── Read-replica routing endpoints — Issue #881 ───────────────────────────────

/**
 * GET /database/replicas
 *
 * Returns the health status and routing metadata for every configured
 * read replica.  Includes the global router configuration (maxLagMs) and a
 * per-replica breakdown.
 */
router.get('/replicas', (_req: Request, res: Response) => {
  const replicas = readReplicaRouter.snapshot();
  const healthy  = replicas.filter((r) => !r.disabled && r.health === 'healthy').length;

  res.json({
    data: {
      total: replicas.length,
      healthy,
      unhealthy: replicas.filter((r) => r.health === 'unhealthy' && !r.disabled).length,
      lagging:   replicas.filter((r) => r.health === 'lagging'   && !r.disabled).length,
      disabled:  replicas.filter((r) => r.disabled).length,
      replicas: replicas.map((r) => ({
        url: r.url,
        health: r.health,
        lagMs: r.lagMs,
        failureCount: r.failureCount,
        disabled: r.disabled,
        inCooldown: r.cooldownUntil > Date.now(),
        cooldownUntil: r.cooldownUntil > 0 ? new Date(r.cooldownUntil).toISOString() : null,
        lastCheckedAt: r.lastCheckedAt > 0 ? new Date(r.lastCheckedAt).toISOString() : null,
      })),
    },
  });
});

/**
 * POST /database/replicas/:url/disable
 *
 * Administratively removes a replica from the routing pool.  Useful for
 * planned maintenance without restarting the app.
 *
 * The `:url` segment must be URL-encoded (e.g. encodeURIComponent(replicaUrl)).
 */
router.post('/replicas/:url/disable', (req: Request, res: Response) => {
  const rawUrl = req.params['url'];
  const url = decodeURIComponent(Array.isArray(rawUrl) ? rawUrl[0] ?? '' : (rawUrl ?? ''));
  if (!url) {
    res.status(400).json({ error: 'replica url is required' });
    return;
  }

  const before = readReplicaRouter.snapshot().find((r) => r.url === url);
  if (!before) {
    res.status(404).json({ error: `Replica not found: ${url}` });
    return;
  }

  readReplicaRouter.disableReplica(url);
  res.json({ data: { url, disabled: true, message: 'Replica disabled — traffic will route to remaining healthy replicas or primary.' } });
});

/**
 * POST /database/replicas/:url/enable
 *
 * Re-admits a previously disabled replica into the routing pool.
 */
router.post('/replicas/:url/enable', (req: Request, res: Response) => {
  const rawUrl = req.params['url'];
  const url = decodeURIComponent(Array.isArray(rawUrl) ? rawUrl[0] ?? '' : (rawUrl ?? ''));
  if (!url) {
    res.status(400).json({ error: 'replica url is required' });
    return;
  }

  const before = readReplicaRouter.snapshot().find((r) => r.url === url);
  if (!before) {
    res.status(404).json({ error: `Replica not found: ${url}` });
    return;
  }

  readReplicaRouter.enableReplica(url);
  res.json({ data: { url, disabled: false, message: 'Replica enabled — will receive read traffic on the next health check cycle.' } });
});

export { router as databaseRouter };