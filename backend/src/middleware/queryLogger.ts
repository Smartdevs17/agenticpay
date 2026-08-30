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
import * as Sentry from '@sentry/node';

import {
  queryProfiler,
  onSlowQuery,
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

// ── Query Analysis & Index Optimization ────────────────────────────────────

export interface QueryAntiPattern {
  type: 'select_star' | 'missing_where' | 'distinct_overuse' | 'order_by_without_limit' | 'function_on_indexed_column' | 'implicit_type_conversion' | 'non_sargable_like';
  description: string;
  suggestion: string;
  severity: 'low' | 'medium' | 'high';
}

export interface IndexSuggestion {
  table: string;
  columns: string[];
  reason: string;
  queryPattern: string;
}

export interface QueryAnalysisResult {
  antiPatterns: QueryAntiPattern[];
  indexSuggestions: IndexSuggestion[];
  tableReferences: string[];
  estimatedRows?: number;
}

const TABLE_INDEX_HINTS: Record<string, { columns: string[]; reason: string }[]> = {
  payments: [
    { columns: ['tenant_id', 'status'], reason: 'Dashboard filters by tenant and payment status' },
    { columns: ['tenant_id', 'created_at'], reason: 'Paginated payment history per tenant' },
    { columns: ['user_id', 'created_at'], reason: 'User payment history ordered by date' },
  ],
  projects: [
    { columns: ['tenant_id', 'status'], reason: 'Active/archived project listings' },
    { columns: ['tenant_id', 'created_at'], reason: 'Recent projects per tenant' },
  ],
  invoices: [
    { columns: ['tenant_id', 'status'], reason: 'Invoice dashboard status filters' },
    { columns: ['tenant_id', 'due_at'], reason: 'Overdue invoice queries' },
  ],
  milestones: [
    { columns: ['project_id', 'status'], reason: 'Milestone progress tracking per project' },
  ],
  webhooks: [
    { columns: ['tenant_id', 'status'], reason: 'Active webhook endpoints per tenant' },
  ],
  outbox_events: [
    { columns: ['status', 'attempts'], reason: 'Retry queue prioritization' },
    { columns: ['status', 'created_at'], reason: 'Oldest pending events for processing' },
  ],
  audit_logs: [
    { columns: ['entity_id', 'created_at'], reason: 'Audit trail per entity ordered chronologically' },
    { columns: ['actor', 'action', 'timestamp'], reason: 'Actor action audit queries' },
  ],
};

export function extractTableNames(sql: string): string[] {
  const tables = new Set<string>();
  const normalized = sql.replace(/\s+/g, ' ').toLowerCase();

  const fromMatches = normalized.match(/from\s+"?([a-z_][a-z0-9_]*)"?/g);
  if (fromMatches) {
    fromMatches.forEach((m) => {
      const t = m.replace(/^from\s+"?/, '').replace(/"?$/, '');
      if (t !== 'pg_catalog' && t !== 'information_schema') tables.add(t);
    });
  }

  const joinMatches = normalized.match(/join\s+"?([a-z_][a-z0-9_]*)"?/g);
  if (joinMatches) {
    joinMatches.forEach((m) => {
      const t = m.replace(/^join\s+"?/, '').replace(/"?$/, '');
      tables.add(t);
    });
  }

  const updateMatches = normalized.match(/update\s+"?([a-z_][a-z0-9_]*)"?/g);
  if (updateMatches) {
    updateMatches.forEach((m) => {
      const t = m.replace(/^update\s+"?/, '').replace(/"?$/, '');
      tables.add(t);
    });
  }

  const insertMatches = normalized.match(/into\s+"?([a-z_][a-z0-9_]*)"?/g);
  if (insertMatches) {
    insertMatches.forEach((m) => {
      const t = m.replace(/^into\s+"?/, '').replace(/"?$/, '');
      tables.add(t);
    });
  }

  const deleteMatches = normalized.match(/delete\s+from\s+"?([a-z_][a-z0-9_]*)"?/g);
  if (deleteMatches) {
    deleteMatches.forEach((m) => {
      const t = m.replace(/^delete\s+from\s+"?/, '').replace(/"?$/, '');
      tables.add(t);
    });
  }

  return Array.from(tables);
}

export function extractWhereColumns(sql: string): string[] {
  const columns = new Set<string>();
  const normalized = sql.replace(/\s+/g, ' ');
  const whereMatch = normalized.match(/where\s+(.*?)(?:\s+group\s+by|\s+order\s+by|\s+limit|\s+having|;?$)/i);
  if (!whereMatch) return [];

  const whereClause = whereMatch[1];
  const colMatches = whereClause.match(/([a-z_][a-z0-9_]*)\s*(=|>|<|>=|<=|!=|<>|in|like|between)\s*/gi);
  if (colMatches) {
    colMatches.forEach((m) => {
      const col = m.split(/\s/)[0].toLowerCase();
      if (!['and', 'or', 'not', 'is', 'null', 'true', 'false'].includes(col)) {
        columns.add(col);
      }
    });
  }

  const fkMatches = whereClause.match(/([a-z_][a-z0-9_]*_id)\s*/gi);
  if (fkMatches) {
    fkMatches.forEach((m) => columns.add(m.trim().toLowerCase()));
  }

  return Array.from(columns);
}

export function detectQueryAntiPatterns(sql: string): QueryAntiPattern[] {
  const patterns: QueryAntiPattern[] = [];
  const normalized = sql.replace(/\s+/g, ' ').trim();

  if (/SELECT\s+\*/i.test(normalized)) {
    patterns.push({
      type: 'select_star',
      description: 'Query uses SELECT * which fetches unnecessary columns',
      suggestion: 'Explicitly list only the columns needed to reduce I/O and enable index-only scans',
      severity: 'medium',
    });
  }

  const isSelect = /^SELECT\b/i.test(normalized);
  const hasWhere = /\bWHERE\b/i.test(normalized);
  const hasJoin = /\bJOIN\b/i.test(normalized);
  if (isSelect && !hasWhere && !hasJoin) {
    patterns.push({
      type: 'missing_where',
      description: 'SELECT query without WHERE clause may scan the entire table',
      suggestion: 'Add a WHERE clause to filter rows early, or confirm this full-table scan is intentional',
      severity: 'high',
    });
  }

  const distinctCount = (normalized.match(/\bDISTINCT\b/gi) || []).length;
  if (distinctCount > 0) {
    const orderByWithoutLimit = /\bORDER\s+BY\b(?!.*\bLIMIT\b)/i.test(normalized);
    if (distinctCount >= 2 || (distinctCount === 1 && orderByWithoutLimit)) {
      patterns.push({
        type: 'distinct_overuse',
        description: 'DISTINCT with multiple columns or large datasets causes expensive sort operations',
        suggestion: 'Consider using GROUP BY, EXISTS, or a subquery instead of DISTINCT for deduplication',
        severity: 'medium',
      });
    }
  }

  if (isSelect && /\bORDER\s+BY\b/i.test(normalized) && !/\bLIMIT\b/i.test(normalized)) {
    patterns.push({
      type: 'order_by_without_limit',
      description: 'ORDER BY without LIMIT requires sorting the entire result set',
      suggestion: 'Add a LIMIT clause if only top N rows are needed, or ensure an index covers the ORDER BY columns',
      severity: 'low',
    });
  }

  const functionOnCol = normalized.match(/(LOWER|UPPER|COALESCE|DATE_TRUNC|TO_CHAR|EXTRACT|TRUNC|ROUND)\s*\(\s*([a-z_][a-z0-9_]*)\s*\)/i);
  if (functionOnCol) {
    patterns.push({
      type: 'function_on_indexed_column',
      description: `Function ${functionOnCol[1]}() wrapping column "${functionOnCol[2]}" prevents index usage`,
      suggestion: `Use a functional/expression index on ${functionOnCol[1]}(${functionOnCol[2]}) or restructure the predicate to avoid wrapping the column`,
      severity: 'high',
    });
  }

  const badLike = normalized.match(/LIKE\s+'%[^']+/i);
  if (badLike) {
    patterns.push({
      type: 'non_sargable_like',
      description: 'LIKE pattern with leading wildcard cannot use a B-tree index',
      suggestion: 'Consider trigram/GIN indexes for prefix searches, a full-text search index, or restructure to avoid the leading wildcard',
      severity: 'medium',
    });
  }

  return patterns;
}

export function suggestIndexes(sql: string): IndexSuggestion[] {
  const suggestions: IndexSuggestion[] = [];
  const tables = extractTableNames(sql);
  const whereCols = extractWhereColumns(sql);

  if (tables.length === 0 || whereCols.length === 0) return suggestions;

  for (const table of tables) {
    const hints = TABLE_INDEX_HINTS[table];
    if (!hints) continue;

    for (const hint of hints) {
      const matched = hint.columns.filter((c) =>
        whereCols.some((wc) => c === wc || c.endsWith(`_${wc}`) || wc.endsWith(`_${c}`) || wc === c.replace(/_/g, '')),
      );
      if (matched.length > 0) {
        const querySig = querySignature(sql);
        if (!suggestions.some((s) => s.table === table && s.columns.join(',') === hint.columns.join(','))) {
          suggestions.push({
            table,
            columns: hint.columns,
            reason: hint.reason,
            queryPattern: querySig,
          });
        }
      }
    }
  }

  return suggestions;
}

export function analyzeQuery(sql: string): QueryAnalysisResult {
  const antiPatterns = detectQueryAntiPatterns(sql);
  const indexSuggestions = suggestIndexes(sql);
  const tableReferences = extractTableNames(sql);

  return {
    antiPatterns,
    indexSuggestions,
    tableReferences,
  };
}

// ── N+1 Query Detection ────────────────────────────────────────────────────

export interface NPlusOneCandidate {
  baseQuery: string;
  repeatedPattern: string;
  count: number;
  timeWindowMs: number;
  detectedAt: string;
}

interface RecentQuery {
  signature: string;
  timestamp: number;
  query: string;
}

const recentQueries: RecentQuery[] = [];
const MAX_RECENT_QUERIES = 500;
const N_PLUS_ONE_WINDOW_MS = 5000;
const N_PLUS_ONE_THRESHOLD = 5;

function recordRecentQuery(query: string): void {
  const now = Date.now();
  recentQueries.push({
    signature: querySignature(query),
    timestamp: now,
    query,
  });
  if (recentQueries.length > MAX_RECENT_QUERIES) {
    recentQueries.splice(0, recentQueries.length - MAX_RECENT_QUERIES);
  }
  while (recentQueries.length > 0 && now - recentQueries[0].timestamp > N_PLUS_ONE_WINDOW_MS * 2) {
    recentQueries.shift();
  }
}

export function detectNPlusOne(query: string): NPlusOneCandidate | null {
  recordRecentQuery(query);
  const now = Date.now();
  const windowStart = now - N_PLUS_ONE_WINDOW_MS;

  const inWindow = recentQueries.filter((q) => q.timestamp >= windowStart);
  if (inWindow.length < N_PLUS_ONE_THRESHOLD + 1) return null;

  const sigCounts = new Map<string, { count: number; first: RecentQuery }>();
  for (const q of inWindow) {
    const existing = sigCounts.get(q.signature);
    if (existing) {
      existing.count++;
    } else {
      sigCounts.set(q.signature, { count: 1, first: q });
    }
  }

  for (const [sig, data] of sigCounts.entries()) {
    if (data.count >= N_PLUS_ONE_THRESHOLD) {
      const base = inWindow.find((q) => q.signature !== sig);
      return {
        baseQuery: base ? querySignature(base.query) : 'unknown',
        repeatedPattern: sig,
        count: data.count,
        timeWindowMs: N_PLUS_ONE_WINDOW_MS,
        detectedAt: new Date().toISOString(),
      };
    }
  }

  return null;
}

export function resetNPlusOneDetector(): void {
  recentQueries.length = 0;
}

// ── Wire analysis into the Prisma query listener ────────────────────────────

const nPlusOneDetections: NPlusOneCandidate[] = [];
const MAX_N_PLUS_ONE_DETECTIONS = 50;

export function getNPlusOneDetections(): NPlusOneCandidate[] {
  return [...nPlusOneDetections];
}

const analysisReports: Array<{ query: string; analysis: QueryAnalysisResult; durationMs: number; timestamp: string }> = [];
const MAX_ANALYSIS_REPORTS = 100;

export function getAnalysisReports(): typeof analysisReports {
  return [...analysisReports];
}

export function getOptimizationSummary() {
  const antiPatternCounts = new Map<string, number>();
  for (const r of analysisReports) {
    for (const ap of r.analysis.antiPatterns) {
      antiPatternCounts.set(ap.type, (antiPatternCounts.get(ap.type) || 0) + 1);
    }
  }

  const indexCounts = new Map<string, number>();
  for (const r of analysisReports) {
    for (const idx of r.analysis.indexSuggestions) {
      const key = `${idx.table}(${idx.columns.join(',')})`;
      indexCounts.set(key, (indexCounts.get(key) || 0) + 1);
    }
  }

  return {
    totalQueriesAnalyzed: analysisReports.length,
    queriesWithAntiPatterns: analysisReports.filter((r) => r.analysis.antiPatterns.length > 0).length,
    queriesWithIndexSuggestions: analysisReports.filter((r) => r.analysis.indexSuggestions.length > 0).length,
    nPlusOneDetected: nPlusOneDetections.length,
    antiPatternBreakdown: Object.fromEntries(antiPatternCounts.entries()),
    topIndexSuggestions: Array.from(indexCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => ({ index: key, count })),
  };
}

function analyzedPrismaListener(original: ReturnType<typeof createPrismaQueryListener>) {
  return (event: QueryEvent) => {
    original(event);

    if (event.duration >= config.slowThresholdMs) {
      const analysis = analyzeQuery(event.query);
      analysisReports.push({
        query: event.query.slice(0, 500),
        analysis,
        durationMs: event.duration,
        timestamp: new Date().toISOString(),
      });
      if (analysisReports.length > MAX_ANALYSIS_REPORTS) analysisReports.shift();

      if (analysis.antiPatterns.length > 0 && event.duration >= config.criticalThresholdMs) {
        console.warn(
          `[QueryLogger] Anti-patterns detected in slow query: ${analysis.antiPatterns.map((a) => a.type).join(', ')}`,
        );
      }
    }

    const nPlusOne = detectNPlusOne(event.query);
    if (nPlusOne) {
      nPlusOneDetections.push(nPlusOne);
      if (nPlusOneDetections.length > MAX_N_PLUS_ONE_DETECTIONS) nPlusOneDetections.shift();
      if (shouldAlert(`n+1:${nPlusOne.repeatedPattern}`)) {
        console.warn(
          `[QueryLogger] N+1 pattern detected: ${nPlusOne.count} repeated queries within ${nPlusOne.timeWindowMs}ms`,
        );
      }
    }
  };
}

export function createAnalyzedPrismaQueryListener() {
  return analyzedPrismaListener(createPrismaQueryListener());
}

export function attachAnalyzedQueryLogger(prisma: { $on: (event: string, handler: (e: QueryEvent) => void) => void }): void {
  prisma.$on('query', createAnalyzedPrismaQueryListener());
  console.log('[QueryLogger] Analyzed query logger attached to Prisma client');
}

export function resetAnalysisState(): void {
  resetNPlusOneDetector();
  nPlusOneDetections.length = 0;
  analysisReports.length = 0;
  resetQueryMetrics();
}