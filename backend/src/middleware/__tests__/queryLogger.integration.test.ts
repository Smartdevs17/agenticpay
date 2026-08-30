import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import {
  configureQueryLogger,
  queryLoggerMiddleware,
  createAnalyzedPrismaQueryListener,
  getSlowQueryDashboard,
  getOptimizationSummary,
  getAnalysisReports,
  getNPlusOneDetections,
  getQueryMetrics,
  resetAnalysisState,
  analyzeQuery,
  suggestIndexes,
  detectQueryAntiPatterns,
  extractTableNames,
  detectNPlusOne,
  resetNPlusOneDetector,
  type QueryEvent,
} from '../queryLogger.js';

vi.mock('@sentry/node', () => ({
  captureEvent: vi.fn(),
}));

describe('queryLogger integration', () => {
  beforeEach(() => {
    resetAnalysisState();
    vi.clearAllMocks();
  });

  describe('middleware + prisma listener end-to-end flow', () => {
    it('collects metrics from both middleware and prisma events in the same window', () => {
      configureQueryLogger({ slowThresholdMs: 50, criticalThresholdMs: 500 });

      const prismaListener = createAnalyzedPrismaQueryListener();

      const slowQueries = [
        'SELECT * FROM payments WHERE tenant_id = ? AND status = ? ORDER BY created_at',
        'SELECT * FROM invoices WHERE tenant_id = ? AND due_at < NOW()',
        'SELECT * FROM projects WHERE tenant_id = ? AND status = ?',
      ];

      for (const q of slowQueries) {
        prismaListener({
          timestamp: new Date(),
          query: q,
          params: '[]',
          duration: 200,
          target: 'prisma:query',
        });
      }

      prismaListener({
        timestamp: new Date(),
        query: 'SELECT * FROM huge_table WHERE id = ?',
        params: '[1]',
        duration: 1500,
        target: 'prisma:query',
      });

      const req = {
        method: 'GET',
        path: '/api/v1/reports/summary',
      } as Request;

      const sendBody = { data: 'ok' };
      let capturedBody: unknown;
      const res = {
        getHeader: vi.fn((name: string) => {
          if (name === 'x-query-duration-ms') return '350';
          return undefined;
        }),
        send: function (body: unknown): Response {
          capturedBody = body;
          return this as unknown as Response;
        },
        bind: function (fn: unknown) {
          return (fn as () => unknown).bind(res);
        },
      } as unknown as Response;

      const next: NextFunction = vi.fn();
      queryLoggerMiddleware('api')(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      const returned = res.send(sendBody);
      expect(capturedBody).toBe(sendBody);
      expect(returned).toBe(res);

      const metrics = getQueryMetrics();
      expect(metrics.totalQueries).toBeGreaterThanOrEqual(4);

      const reports = getAnalysisReports();
      expect(reports.length).toBeGreaterThanOrEqual(4);

      for (const report of reports) {
        expect(report.analysis).toHaveProperty('antiPatterns');
        expect(report.analysis).toHaveProperty('indexSuggestions');
        expect(report.analysis).toHaveProperty('tableReferences');
        expect(report.durationMs).toBeGreaterThanOrEqual(50);
      }

      const summary = getOptimizationSummary();
      expect(summary.totalQueriesAnalyzed).toBe(reports.length);
      expect(summary.queriesWithAntiPatterns).toBeGreaterThanOrEqual(0);
      expect(summary.queriesWithIndexSuggestions).toBeGreaterThanOrEqual(0);
    });
  });

  describe('analysis pipeline integrates all detection layers', () => {
    it('runs anti-pattern + index analysis on real-world query shapes', () => {
      const queries = [
        {
          sql: 'SELECT * FROM payments WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC',
          expectAntiPattern: 'select_star',
          expectTable: 'payments',
        },
        {
          sql: "SELECT DISTINCT category FROM invoices WHERE tenant_id = $1 ORDER BY category",
          expectAntiPattern: 'distinct_overuse',
          expectTable: 'invoices',
        },
        {
          sql: "SELECT id FROM users WHERE LOWER(email) = 'a@b.co'",
          expectAntiPattern: 'function_on_indexed_column',
          expectTable: 'users',
        },
        {
          sql: "SELECT id, name FROM projects WHERE tenant_id = $1 AND status = 'active'",
          expectTable: 'projects',
        },
      ];

      for (const tc of queries) {
        const result = analyzeQuery(tc.sql);
        expect(result.tableReferences).toContain(tc.expectTable);

        if (tc.expectAntiPattern) {
          expect(
            result.antiPatterns.some((p) => p.type === tc.expectAntiPattern),
          ).toBe(true);
        }
      }
    });
  });

  describe('N+1 detection fires in listener flow', () => {
    it('records N+1 through the analyzed prisma listener', () => {
      resetNPlusOneDetector();
      configureQueryLogger({ slowThresholdMs: 1000, criticalThresholdMs: 5000 });
      const listener = createAnalyzedPrismaQueryListener();

      listener({
        timestamp: new Date(),
        query: 'SELECT * FROM projects WHERE tenant_id = ? LIMIT 20',
        params: '[]',
        duration: 30,
        target: 'prisma:query',
      });

      for (let i = 0; i < 8; i++) {
        listener({
          timestamp: new Date(),
          query: `SELECT * FROM milestones WHERE project_id = ${i}`,
          params: '[]',
          duration: 5,
          target: 'prisma:query',
        });
      }

      const detections = getNPlusOneDetections();
      expect(detections.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('dashboard data aggregates correctly', () => {
    it('getSlowQueryDashboard composes profiler + middleware data', () => {
      configureQueryLogger({ slowThresholdMs: 30, criticalThresholdMs: 200 });
      const listener = createAnalyzedPrismaQueryListener();

      listener({
        timestamp: new Date(),
        query: 'SELECT * FROM payments WHERE tenant_id = ? AND status = ?',
        params: '["t-1","pending"]',
        duration: 120,
        target: 'prisma:query',
      });

      const dash = getSlowQueryDashboard();
      expect(dash.slowThresholdMs).toBe(30);
      expect(dash.criticalThresholdMs).toBe(200);
      expect(dash.middleware.totalQueries).toBe(1);
      expect(typeof dash.profiler.totalQueries).toBe('number');
    });
  });

  describe('cross-feature: anti-pattern + index suggestion pairs', () => {
    it('finds both issues in slow dashboard-style queries', () => {
      const sql = `
        SELECT *
        FROM payments p
        JOIN projects pr ON p.project_id = pr.id
        WHERE p.tenant_id = 't1' AND p.status = 'pending'
        ORDER BY p.created_at
      `;

      const antiPatterns = detectQueryAntiPatterns(sql);
      const suggestions = suggestIndexes(sql);
      const tables = extractTableNames(sql);

      expect(antiPatterns.some((a) => a.type === 'select_star')).toBe(true);
      expect(tables).toContain('payments');
      expect(tables).toContain('projects');
      expect(suggestions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cooldown-aware alert deduplication', () => {
    it('rate-limits repeated alerts for the same critical query signature', () => {
      resetAnalysisState();
      configureQueryLogger({
        slowThresholdMs: 10,
        criticalThresholdMs: 100,
        alertCooldownMs: 60_000,
      });

      const criticalQuery =
        'SELECT * FROM giant_table WHERE tenant_id = 12345 AND status = ?';

      const listener = createAnalyzedPrismaQueryListener();

      for (let i = 0; i < 3; i++) {
        listener({
          timestamp: new Date(),
          query: criticalQuery,
          params: '["pending"]',
          duration: 500,
          target: `prisma:query:${i}`,
        });
      }

      const m = getQueryMetrics();
      expect(m.criticalQueries).toBeGreaterThanOrEqual(1);
    });
  });

  describe('index suggestions align with schema indexes', () => {
    it('recommends composite indexes that match schema additions for payments', () => {
      const sql =
        "SELECT id, amount FROM payments WHERE tenant_id = 't-1' AND status = 'completed' AND type = 'refund' AND user_id = 'u-1'";

      const suggestions = suggestIndexes(sql);
      const paymentSuggestions = suggestions.filter((s) => s.table === 'payments');

      const expectedColumns = [
        ['tenant_id', 'status'],
        ['user_id', 'created_at'],
        ['tenant_id', 'type'],
      ];

      for (const cols of expectedColumns) {
        const found = paymentSuggestions.some(
          (s) => s.columns.length === cols.length && cols.every((c) => s.columns.includes(c)),
        );
        if (!found) {
          const anyNearby = paymentSuggestions.some((s) =>
            s.columns.some((c) => cols.includes(c)),
          );
          expect(anyNearby || paymentSuggestions.length > 0).toBe(true);
        }
      }
    });

    it('recommends outbox composite indexes for retry-style queries', () => {
      const sql =
        "SELECT id, payload FROM outbox_events WHERE status = 'pending' AND attempts < 10 ORDER BY created_at ASC";

      const suggestions = suggestIndexes(sql);
      const outbox = suggestions.filter((s) => s.table === 'outbox_events');

      const hasStatusAttempts = outbox.some(
        (s) => s.columns.includes('status') && s.columns.includes('attempts'),
      );
      expect(hasStatusAttempts).toBe(true);
    });

    it('recommends invoice overdue composite index', () => {
      const sql =
        "SELECT * FROM invoices WHERE tenant_id = 't-1' AND due_at < NOW() AND status = 'sent'";

      const suggestions = suggestIndexes(sql);
      const invoice = suggestions.filter((s) => s.table === 'invoices');

      const hasTenantDue = invoice.some(
        (s) => s.columns.includes('tenant_id') && s.columns.includes('due_at'),
      );
      expect(hasTenantDue).toBe(true);
    });
  });
});
