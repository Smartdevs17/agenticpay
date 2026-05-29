/**
 * cold-start-monitor.ts
 *
 * Monitoring dashboard endpoint for cold start frequency and latency metrics.
 * Exposes:
 *   GET  /api/v1/cold-start/metrics   — full metrics snapshot
 *   GET  /api/v1/cold-start/summary   — lightweight summary (for dashboards)
 *   POST /api/v1/cold-start/reset     — reset counters (admin only)
 *   POST /api/v1/cold-start/warmup    — trigger a warm-up ping (keeps instance alive)
 */

import { Router, Request, Response } from 'express';
import { getColdStartMetrics, resetColdStartMetrics } from '../middleware/cold-start.js';
import { getLazyModuleRegistry } from '../lib/lazy-loader.js';

export const coldStartMonitorRouter = Router();

/**
 * @openapi
 * /api/v1/cold-start/metrics:
 *   get:
 *     summary: Full cold start and latency metrics
 *     responses:
 *       200:
 *         description: Metrics snapshot
 */
coldStartMonitorRouter.get('/metrics', (_req: Request, res: Response) => {
  const metrics = getColdStartMetrics();
  const lazyModules = getLazyModuleRegistry();

  const p95Target = 100; // ms — acceptance criterion
  const p95Met = metrics.p95LatencyMs > 0 && metrics.p95LatencyMs <= p95Target;

  res.json({
    coldStart: {
      ...metrics,
      p95TargetMs: p95Target,
      p95TargetMet: p95Met,
    },
    lazyModules: {
      total: lazyModules.length,
      loaded: lazyModules.filter((m) => m.loaded).length,
      pending: lazyModules.filter((m) => !m.loaded).length,
      modules: lazyModules,
    },
    process: {
      uptime: process.uptime(),
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  });
});

/**
 * @openapi
 * /api/v1/cold-start/summary:
 *   get:
 *     summary: Lightweight cold start summary for dashboards
 *     responses:
 *       200:
 *         description: Summary
 */
coldStartMonitorRouter.get('/summary', (_req: Request, res: Response) => {
  const m = getColdStartMetrics();
  const p95Target = 100;

  res.json({
    status: m.p95LatencyMs <= p95Target || m.totalRequests === 0 ? 'ok' : 'degraded',
    coldStartCount: m.coldStartCount,
    totalRequests: m.totalRequests,
    initDurationMs: m.initDurationMs,
    p95LatencyMs: m.p95LatencyMs,
    p95TargetMs: p95Target,
    p95TargetMet: m.p95LatencyMs <= p95Target || m.totalRequests === 0,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/**
 * @openapi
 * /api/v1/cold-start/reset:
 *   post:
 *     summary: Reset cold start counters (admin)
 *     responses:
 *       200:
 *         description: Counters reset
 */
coldStartMonitorRouter.post('/reset', (_req: Request, res: Response) => {
  resetColdStartMetrics();
  res.json({ ok: true, message: 'Cold start metrics reset' });
});

/**
 * @openapi
 * /api/v1/cold-start/warmup:
 *   post:
 *     summary: Warm-up ping — keeps the instance alive and pre-warms connections
 *     responses:
 *       200:
 *         description: Instance is warm
 */
coldStartMonitorRouter.post('/warmup', (_req: Request, res: Response) => {
  // This endpoint is intentionally lightweight — its purpose is to be called
  // by a scheduler (cron, Cloudflare Worker cron trigger, etc.) to prevent
  // the process from going idle and triggering a cold start on the next real request.
  res.json({
    ok: true,
    warm: true,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});
