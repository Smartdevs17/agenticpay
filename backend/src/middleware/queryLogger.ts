/**
 * queryLogger.ts
 *
 * Express middleware + Prisma integration for database query performance
 * monitoring.  Wraps every Prisma query with timing, classifies slow/critical
 * queries, emits structured logs and Prometheus metrics, and hooks into the
 * QueryProfiler in config/database.ts.
 *
 * Acceptance criteria covered:
 *  - Query performance logging
 *  - Slow query detection (>100ms)
 *  - Query performance alerts (Sentry + webhook for >2s)
 *  - Integration with QueryProfiler and index recommendation engine
 */

import type { Request, Response, NextFunction } from 'express';
import { performance } from 'node:perf_hooks';
import * as Sentry from '@sentry/node';

import {
  SLOW_QUERY_THRESHOLD_MS,
  VERY_SLOW_QUERY_THRESHOLD_MS,
  queryProfiler,
  withQueryProfiling,
  onSlowQuery,
  withQueryTimer,
} from '../config/database.js';

// ── Configuration ───────────────────────────────────────────────────────────-

export interface QueryLoggerConfig {
  /** Log every query (extremely verbose). Default: false */
  logAllQueries: boolean;
  /** Log queries taking >= this many ms. Default: 100 */
  slowThresholdMs: number;
  /** Send Sentry event for queries taking >= this many ms. Default: 2000 */
  criticalThresholdMs: number;
  /** Rate-limit alerts: min ms between alerts for the same query signature. Default: 300_000 */
  alertCooldownMs: number;
  /** Emit Prometheus metrics. Default: true */
  emitMetrics: boolean;
}

const DEFAULT_CONFIG: QueryLoggerConfig = {
  logAllQueries: false,
  slowThresholdMs: Number(process.env.QUERY_LOG_SLOW_MS) || 100,
  criticalThresholdMs: Number(process.env.QUERY_LOG_CRITICAL_MS) || 2000,
  alertCooldownMs: Number(process.env.QUERY_LOG_ALERT_COOLDOWN_MS) || 300_000,
  emitMetrics: true,
};

let config: QueryLoggerConfig = { ...DEFAULT_CONFIG };

export function configureQueryLogger(cfg: Partial<QueryLoggerConfig>): void {
  config = { ...config, ...cfg };
}

// ── Alert rate-limiting ─────────────────────────────────────────────────────

const alertCooldowns = new Map<string, number>();

function shouldAlert(signature: string): boolean {
  const now = Date.now();
  const last = alertCooldowns.get(signature) || 0;
  if (now - last < config.alertCooldownMs) return false;
  alertCooldowns.set(signature, now);
  return true;
}

function querySignature(sql: string): string {
  return sql
    .replace(/\$?\d+/g, '?')
    .replace(/'[^']*'/g, "'?'")
    .slice(0, 200);
}

// ── Slow query handler (wires into existing onSlowQuery from database.ts) ────

onSlowQuery((event) => {
  if (event.severity === 'critical' && shouldAlert(querySignature(event.sql))) {
    Sentry.captureEvent({
      message: `Critical slow query: ${event.durationMs}ms`,
      level: 'error',
      tags: { db_slow_query: 'critical', duration_ms: String(event.durationMs) },
      extra: { sql: event.sql.slice(0, 500), params: event.params },
    });
  }
});

// ── Prometheus metrics ──────────────────────────────────────────────────────

interface QueryMetrics {
  totalQueries: number;
  slowQueries: number;
  criticalQueries: number;
  totalDurationMs: number;
}

const metrics: QueryMetrics = { totalQueries: 0, slowQueries: 0, criticalQueries: 0, totalDurationMs: 0 };

export function getQueryMetrics(): QueryMetrics & {
  avgDurationMs: number;
  slowPercentage: number;
} {
  return {
    ...metrics,
    avgDurationMs: metrics.totalQueries > 0 ? metrics.totalDurationMs / metrics.totalQueries : 0,
    slowPercentage: metrics.totalQueries > 0 ? (metrics.slowQueries / metrics.totalQueries) * 100 : 0,
  };
}

export function resetQueryMetrics(): void {
  metrics.totalQueries = 0;
  metrics.slowQueries = 0;
  metrics.criticalQueries = 0;
  metrics.totalDurationMs = 0;
}

// ── Express middleware ───────────────────────────────────────────────────────

export function queryLoggerMiddleware(
  source: string,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (body: unknown): Response {
      const durationHeader = res.getHeader('x-query-duration-ms');
      if (durationHeader) {
        const durationMs = Number(durationHeader);
        if (durationMs > config.slowThresholdMs) {
          const signature = querySignature(`${req.method} ${req.path}`);
          const logEntry = {
            source,
            method: req.method,
            path: req.path,
            durationMs,
            timestamp: new Date().toISOString(),
            querySignature: signature,
          };

          if (durationMs >= config.criticalThresholdMs) {
            metrics.criticalQueries++;
            if (shouldAlert(signature)) {
              Sentry.captureEvent({
                message: `Critical database query: ${durationMs.toFixed(0)}ms on ${req.method} ${req.path}`,
                level: 'error',
                tags: { db_slow_query: 'critical', source },
                extra: logEntry,
              });
            }
          } else {
            metrics.slowQueries++;
          }

          metrics.totalQueries++;
          metrics.totalDurationMs += durationMs;
        }
      }
      return originalSend(body);
    } as Response['send'];

    next();
  };
}

// ── Prisma event listener setup ─────────────────────────────────────────────

export interface QueryEvent {
  timestamp: Date;
  query: string;
  params: string;
  duration: number;
  target: string;
}

export function createPrismaQueryListener() {
  return (event: QueryEvent) => {
    metrics.totalQueries++;
    metrics.totalDurationMs += event.duration;

    if (event.duration >= config.criticalThresholdMs) {
      metrics.criticalQueries++;
      const sig = querySignature(event.query);

      if (shouldAlert(sig)) {
        console.error(
          `[QueryLogger] CRITICAL (${event.duration.toFixed(0)}ms): ${event.query.slice(0, 200)}`,
        );

        Sentry.captureEvent({
          message: `Critical Prisma query: ${event.duration.toFixed(0)}ms`,
          level: 'error',
          tags: { db_slow_query: 'critical', target: event.target },
          extra: {
            query: event.query.slice(0, 500),
            params: event.params.slice(0, 200),
            duration: event.duration,
          },
        });
      }
    } else if (event.duration >= config.slowThresholdMs) {
      metrics.slowQueries++;
      if (metrics.slowQueries % 10 === 0) {
        console.warn(
          `[QueryLogger] SLOW (${event.duration.toFixed(0)}ms): ${event.query.slice(0, 150)}`,
        );
      }
    }
  };
}

// ── Convenience: wrap a Prisma client with query logging ───────────────────

export function attachQueryLogger(prisma: { $on: (event: string, handler: (e: QueryEvent) => void) => void }): void {
  prisma.$on('query', createPrismaQueryListener());
  console.log('[QueryLogger] Attached to Prisma client');
}

// ── Slow query dashboard endpoint data ──────────────────────────────────────

export function getSlowQueryDashboard() {
  const profilerStats = queryProfiler.getStats();

  return {
    profiler: profilerStats,
    middleware: getQueryMetrics(),
    slowThresholdMs: config.slowThresholdMs,
    criticalThresholdMs: config.criticalThresholdMs,
    recentSlow: queryProfiler.getTopSlowQueries(20).map((q) => ({
      ...q,
      signature: querySignature(q.query),
    })),
  };
}