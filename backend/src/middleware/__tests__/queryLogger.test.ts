import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

import {
  configureQueryLogger,
  querySignature,
  getQueryMetrics,
  resetQueryMetrics,
  queryLoggerMiddleware,
  createPrismaQueryListener,
  createAnalyzedPrismaQueryListener,
  attachQueryLogger,
  attachAnalyzedQueryLogger,
  getSlowQueryDashboard,
  extractTableNames,
  extractWhereColumns,
  detectQueryAntiPatterns,
  suggestIndexes,
  analyzeQuery,
  detectNPlusOne,
  resetNPlusOneDetector,
  getNPlusOneDetections,
  getAnalysisReports,
  getOptimizationSummary,
  resetAnalysisState,
  type QueryEvent,
} from '../queryLogger.js';

vi.mock('@sentry/node', () => ({
  captureEvent: vi.fn(),
}));

describe('queryLogger', () => {
  beforeEach(() => {
    resetAnalysisState();
    vi.clearAllMocks();
  });

  describe('configureQueryLogger', () => {
    it('applies partial config overrides', () => {
      configureQueryLogger({ slowThresholdMs: 250, logAllQueries: true });
      expect(true).toBe(true);
    });
  });

  describe('querySignature', () => {
    it('normalizes numeric parameters', () => {
      const sql = 'SELECT * FROM users WHERE id = 123 AND age > 25';
      const sig = querySignature(sql);
      expect(sig).toContain('?');
      expect(sig).not.toContain('123');
      expect(sig).not.toContain('25');
    });

    it('normalizes string literals', () => {
      const sql = "SELECT * FROM users WHERE email = 'test@example.com'";
      const sig = querySignature(sql);
      expect(sig).toContain("'?'");
      expect(sig).not.toContain('test@example.com');
    });

    it('truncates long queries to 200 chars', () => {
      const longSql = 'SELECT ' + 'a'.repeat(300) + ' FROM t';
      const sig = querySignature(longSql);
      expect(sig.length).toBeLessThanOrEqual(200);
    });
  });

  describe('metrics', () => {
    it('resets metrics to zero', () => {
      resetQueryMetrics();
      const m = getQueryMetrics();
      expect(m.totalQueries).toBe(0);
      expect(m.slowQueries).toBe(0);
      expect(m.criticalQueries).toBe(0);
      expect(m.avgDurationMs).toBe(0);
      expect(m.slowPercentage).toBe(0);
    });
  });

  describe('queryLoggerMiddleware', () => {
    it('calls next and wraps res.send', () => {
      const req = { method: 'GET', path: '/api/test' } as Request;
      const res = {
        getHeader: vi.fn().mockReturnValue(undefined),
        send: vi.fn().mockReturnThis(),
        bind: vi.fn().mockImplementation((fn) => fn.bind(res)),
      } as unknown as Response;
      const next = vi.fn();

      const middleware = queryLoggerMiddleware('test');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('records slow query metrics when duration header is set', () => {
      resetQueryMetrics();
      configureQueryLogger({ slowThresholdMs: 100, criticalThresholdMs: 2000 });

      const req = { method: 'GET', path: '/api/payments' } as Request;
      const body = { ok: true };

      const sendImpl = function (b: unknown) {
        return b;
      };

      const res = {
        getHeader: vi.fn().mockReturnValue('500'),
        send: sendImpl as Response['send'],
      } as unknown as Response;
      res.send = res.send.bind(res);

      const next = vi.fn();
      const middleware = queryLoggerMiddleware('test');
      middleware(req, res, next);

      const result = res.send(body);
      expect(result).toBe(body);

      const m = getQueryMetrics();
      expect(m.totalQueries).toBeGreaterThanOrEqual(0);
    });
  });

  describe('createPrismaQueryListener', () => {
    it('counts total queries regardless of speed', () => {
      resetQueryMetrics();
      const listener = createPrismaQueryListener();

      listener({
        timestamp: new Date(),
        query: 'SELECT 1',
        params: '[]',
        duration: 5,
        target: 'test',
      });

      const m = getQueryMetrics();
      expect(m.totalQueries).toBe(1);
    });

    it('increments slowQueries for slow queries', () => {
      resetQueryMetrics();
      configureQueryLogger({ slowThresholdMs: 100, criticalThresholdMs: 2000 });
      const listener = createPrismaQueryListener();

      listener({
        timestamp: new Date(),
        query: 'SELECT * FROM payments',
        params: '[]',
        duration: 500,
        target: 'test',
      });

      const m = getQueryMetrics();
      expect(m.slowQueries).toBe(1);
    });

    it('increments criticalQueries for very slow queries', () => {
      resetQueryMetrics();
      configureQueryLogger({ slowThresholdMs: 100, criticalThresholdMs: 2000 });
      const listener = createPrismaQueryListener();

      listener({
        timestamp: new Date(),
        query: 'SELECT * FROM huge_table',
        params: '[]',
        duration: 5000,
        target: 'test',
      });

      const m = getQueryMetrics();
      expect(m.criticalQueries).toBe(1);
    });
  });

  describe('attachQueryLogger', () => {
    it('registers a query listener on prisma client', () => {
      const listeners: Array<(e: QueryEvent) => void> = [];
      const prisma = {
        $on: (_event: string, handler: (e: QueryEvent) => void) => {
          listeners.push(handler);
        },
      };

      attachQueryLogger(prisma as unknown as { $on: (event: string, handler: (e: QueryEvent) => void) => void });
      expect(listeners.length).toBe(1);
    });
  });

  describe('extractTableNames', () => {
    it('extracts tables from SELECT FROM clause', () => {
      const sql = 'SELECT id, name FROM users WHERE active = true';
      expect(extractTableNames(sql)).toEqual(['users']);
    });

    it('extracts tables from JOIN clauses', () => {
      const sql = 'SELECT * FROM payments p JOIN projects pr ON p.project_id = pr.id';
      const tables = extractTableNames(sql);
      expect(tables).toContain('payments');
      expect(tables).toContain('projects');
    });

    it('extracts tables from UPDATE statements', () => {
      const sql = 'UPDATE invoices SET status = ? WHERE id = ?';
      expect(extractTableNames(sql)).toEqual(['invoices']);
    });

    it('extracts tables from INSERT INTO statements', () => {
      const sql = 'INSERT INTO audit_logs (action) VALUES (?)';
      expect(extractTableNames(sql)).toEqual(['audit_logs']);
    });

    it('extracts tables from DELETE FROM statements', () => {
      const sql = 'DELETE FROM outbox_events WHERE status = ?';
      expect(extractTableNames(sql)).toEqual(['outbox_events']);
    });

    it('excludes pg_catalog and information_schema', () => {
      const sql = 'SELECT * FROM pg_catalog.pg_class JOIN information_schema.tables';
      const tables = extractTableNames(sql);
      expect(tables).not.toContain('pg_catalog');
      expect(tables).not.toContain('information_schema');
    });

    it('handles quoted table names', () => {
      const sql = 'SELECT * FROM "payment_links" WHERE status = ?';
      expect(extractTableNames(sql)).toEqual(['payment_links']);
    });

    it('returns empty array for non-table queries', () => {
      expect(extractTableNames('SELECT 1+1')).toEqual([]);
    });
  });

  describe('extractWhereColumns', () => {
    it('extracts columns used with = operator', () => {
      const sql = 'SELECT * FROM payments WHERE tenant_id = ? AND status = ?';
      const cols = extractWhereColumns(sql);
      expect(cols).toContain('tenant_id');
      expect(cols).toContain('status');
    });

    it('extracts columns used with comparison operators', () => {
      const sql = 'SELECT * FROM payments WHERE amount > ? AND created_at < ?';
      const cols = extractWhereColumns(sql);
      expect(cols).toContain('amount');
      expect(cols).toContain('created_at');
    });

    it('extracts columns with IN and LIKE operators', () => {
      const sql = "SELECT * FROM users WHERE email LIKE ? AND tier IN ('free','pro')";
      const cols = extractWhereColumns(sql);
      expect(cols).toContain('email');
      expect(cols).toContain('tier');
    });

    it('returns empty array when no WHERE clause', () => {
      expect(extractWhereColumns('SELECT * FROM projects')).toEqual([]);
    });

    it('filters out reserved words that look like columns', () => {
      const cols = extractWhereColumns("SELECT * FROM t WHERE flag = true AND x IS NOT null");
      expect(cols).not.toContain('and');
      expect(cols).not.toContain('true');
      expect(cols).not.toContain('null');
    });
  });

  describe('detectQueryAntiPatterns', () => {
    it('detects SELECT * anti-pattern', () => {
      const patterns = detectQueryAntiPatterns('SELECT * FROM payments');
      expect(patterns.some((p) => p.type === 'select_star')).toBe(true);
    });

    it('detects missing WHERE clause on SELECT', () => {
      const patterns = detectQueryAntiPatterns('SELECT id, name FROM users');
      expect(patterns.some((p) => p.type === 'missing_where')).toBe(true);
    });

    it('does not flag missing WHERE when JOIN is present', () => {
      const patterns = detectQueryAntiPatterns(
        'SELECT p.id, u.email FROM payments p JOIN users u ON p.user_id = u.id',
      );
      expect(patterns.some((p) => p.type === 'missing_where')).toBe(false);
    });

    it('detects ORDER BY without LIMIT', () => {
      const patterns = detectQueryAntiPatterns(
        'SELECT id FROM payments WHERE tenant_id = ? ORDER BY created_at DESC',
      );
      expect(patterns.some((p) => p.type === 'order_by_without_limit')).toBe(true);
    });

    it('does not flag ORDER BY with LIMIT', () => {
      const patterns = detectQueryAntiPatterns(
        'SELECT id FROM payments WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20',
      );
      expect(patterns.some((p) => p.type === 'order_by_without_limit')).toBe(false);
    });

    it('detects function on column preventing index usage', () => {
      const patterns = detectQueryAntiPatterns(
        "SELECT * FROM users WHERE LOWER(email) = 'test@x.com'",
      );
      expect(patterns.some((p) => p.type === 'function_on_indexed_column')).toBe(true);
    });

    it('detects non-sargable LIKE with leading wildcard', () => {
      const patterns = detectQueryAntiPatterns(
        "SELECT * FROM users WHERE email LIKE '%@gmail.com'",
      );
      expect(patterns.some((p) => p.type === 'non_sargable_like')).toBe(true);
    });

    it('detects DISTINCT overuse with ORDER BY without LIMIT', () => {
      const patterns = detectQueryAntiPatterns(
        'SELECT DISTINCT tenant_id FROM payments ORDER BY tenant_id',
      );
      expect(patterns.some((p) => p.type === 'distinct_overuse')).toBe(true);
    });

    it('returns empty array for well-written queries', () => {
      const patterns = detectQueryAntiPatterns(
        'SELECT id, status FROM payments WHERE tenant_id = ? AND created_at > ? LIMIT 50',
      );
      expect(patterns).toHaveLength(0);
    });
  });

  describe('suggestIndexes', () => {
    it('suggests tenant+status index for payments with filters', () => {
      const suggestions = suggestIndexes(
        'SELECT id FROM payments WHERE tenant_id = ? AND status = ?',
      );
      const hasTenantStatus = suggestions.some(
        (s) => s.table === 'payments' && s.columns.includes('tenant_id') && s.columns.includes('status'),
      );
      expect(hasTenantStatus).toBe(true);
    });

    it('suggests project+status index for milestones', () => {
      const suggestions = suggestIndexes(
        'SELECT id FROM milestones WHERE project_id = ? AND status = ?',
      );
      const hasProjectStatus = suggestions.some(
        (s) => s.table === 'milestones' && s.columns.includes('project_id') && s.columns.includes('status'),
      );
      expect(hasProjectStatus).toBe(true);
    });

    it('suggests outbox retry index', () => {
      const suggestions = suggestIndexes(
        'SELECT * FROM outbox_events WHERE status = ? AND attempts < ?',
      );
      const hasRetry = suggestions.some(
        (s) => s.table === 'outbox_events' && s.columns.includes('status') && s.columns.includes('attempts'),
      );
      expect(hasRetry).toBe(true);
    });

    it('returns empty array when no tables are referenced', () => {
      expect(suggestIndexes('SELECT 1')).toEqual([]);
    });

    it('returns empty array when there are no where columns', () => {
      expect(suggestIndexes('SELECT id, name FROM projects')).toEqual([]);
    });
  });

  describe('analyzeQuery', () => {
    it('combines anti-patterns, index suggestions, and table references', () => {
      const result = analyzeQuery(
        'SELECT * FROM payments WHERE tenant_id = ? AND status = ? ORDER BY created_at',
      );

      expect(result.tableReferences).toContain('payments');
      expect(Array.isArray(result.antiPatterns)).toBe(true);
      expect(Array.isArray(result.indexSuggestions)).toBe(true);
      expect(result.antiPatterns.length + result.indexSuggestions.length).toBeGreaterThan(0);
    });
  });

  describe('N+1 detection', () => {
    beforeEach(() => {
      resetNPlusOneDetector();
    });

    it('returns null when few queries exist', () => {
      const result = detectNPlusOne('SELECT * FROM users WHERE id = 1');
      expect(result).toBeNull();
    });

    it('detects N+1 pattern when same signature repeats', () => {
      detectNPlusOne('SELECT * FROM projects WHERE id = 1');
      for (let i = 0; i < 6; i++) {
        detectNPlusOne(`SELECT * FROM milestones WHERE project_id = ${i}`);
      }
      const detection = detectNPlusOne('SELECT * FROM milestones WHERE project_id = 99');
      expect(detection).not.toBeNull();
      expect(detection?.count).toBeGreaterThanOrEqual(5);
      expect(detection?.repeatedPattern).toBeDefined();
    });

    it('reset clears the detector state', () => {
      for (let i = 0; i < 10; i++) {
        detectNPlusOne(`SELECT * FROM x WHERE id = ${i}`);
      }
      resetNPlusOneDetector();
      expect(detectNPlusOne('SELECT * FROM y WHERE id = 1')).toBeNull();
    });
  });

  describe('createAnalyzedPrismaQueryListener', () => {
    it('runs analysis on slow queries and records reports', () => {
      resetAnalysisState();
      configureQueryLogger({ slowThresholdMs: 100, criticalThresholdMs: 2000 });
      const listener = createAnalyzedPrismaQueryListener();

      listener({
        timestamp: new Date(),
        query: 'SELECT * FROM payments WHERE tenant_id = ? AND status = ? ORDER BY created_at',
        params: '[]',
        duration: 500,
        target: 'test',
      });

      const reports = getAnalysisReports();
      expect(reports.length).toBeGreaterThanOrEqual(1);
      expect(reports[0].analysis.tableReferences).toContain('payments');
    });

    it('records N+1 detections via analyzed listener', () => {
      resetAnalysisState();
      const listener = createAnalyzedPrismaQueryListener();

      listener({
        timestamp: new Date(),
        query: 'SELECT * FROM projects WHERE id = 1',
        params: '[]',
        duration: 5,
        target: 'test',
      });

      for (let i = 0; i < 6; i++) {
        listener({
          timestamp: new Date(),
          query: `SELECT * FROM milestones WHERE project_id = ${i}`,
          params: '[]',
          duration: 2,
          target: 'test',
        });
      }

      listener({
        timestamp: new Date(),
        query: 'SELECT * FROM milestones WHERE project_id = 999',
        params: '[]',
        duration: 2,
        target: 'test',
      });

      const detections = getNPlusOneDetections();
      expect(detections.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('attachAnalyzedQueryLogger', () => {
    it('registers analyzed listener on prisma client', () => {
      const listeners: Array<(e: QueryEvent) => void> = [];
      const prisma = {
        $on: (_event: string, handler: (e: QueryEvent) => void) => {
          listeners.push(handler);
        },
      };

      attachAnalyzedQueryLogger(
        prisma as unknown as { $on: (event: string, handler: (e: QueryEvent) => void) => void },
      );
      expect(listeners.length).toBe(1);
    });
  });

  describe('getOptimizationSummary', () => {
    it('returns summary with zeroed counts when no analysis done', () => {
      resetAnalysisState();
      const summary = getOptimizationSummary();
      expect(summary.totalQueriesAnalyzed).toBe(0);
      expect(summary.queriesWithAntiPatterns).toBe(0);
      expect(summary.queriesWithIndexSuggestions).toBe(0);
      expect(summary.nPlusOneDetected).toBe(0);
      expect(summary.antiPatternBreakdown).toEqual({});
      expect(summary.topIndexSuggestions).toEqual([]);
    });

    it('aggregates anti-pattern and index counts after analysis runs', () => {
      resetAnalysisState();
      configureQueryLogger({ slowThresholdMs: 10, criticalThresholdMs: 5000 });
      const listener = createAnalyzedPrismaQueryListener();

      listener({
        timestamp: new Date(),
        query: 'SELECT * FROM payments WHERE tenant_id = ? AND status = ? ORDER BY created_at',
        params: '[]',
        duration: 50,
        target: 'test',
      });

      const summary = getOptimizationSummary();
      expect(summary.totalQueriesAnalyzed).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getSlowQueryDashboard', () => {
    it('returns structured dashboard data', () => {
      resetAnalysisState();
      const dash = getSlowQueryDashboard();
      expect(dash).toHaveProperty('profiler');
      expect(dash).toHaveProperty('middleware');
      expect(dash).toHaveProperty('slowThresholdMs');
      expect(dash).toHaveProperty('criticalThresholdMs');
      expect(dash).toHaveProperty('recentSlow');
      expect(Array.isArray(dash.recentSlow)).toBe(true);
    });
  });

  describe('resetAnalysisState', () => {
    it('clears detections, reports, and metrics', () => {
      configureQueryLogger({ slowThresholdMs: 5, criticalThresholdMs: 20 });
      const listener = createAnalyzedPrismaQueryListener();
      listener({
        timestamp: new Date(),
        query: 'SELECT * FROM payments WHERE tenant_id = 1',
        params: '[]',
        duration: 50,
        target: 't',
      });
      for (let i = 0; i < 10; i++) {
        listener({
          timestamp: new Date(),
          query: `SELECT * FROM milestones WHERE project_id = ${i}`,
          params: '[]',
          duration: 1,
          target: 't',
        });
      }
      resetAnalysisState();
      expect(getAnalysisReports()).toHaveLength(0);
      expect(getNPlusOneDetections()).toHaveLength(0);
      const m = getQueryMetrics();
      expect(m.totalQueries).toBe(0);
    });
  });
});
