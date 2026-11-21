import { describe, expect, it } from 'vitest';
import {
  fingerprintQuery,
  extractTable,
  analyseQuery,
  recommendIndexes,
  detectFullTableScans,
  consolidateByTable,
} from '../query-optimization.js';

describe('query-optimization', () => {
  describe('fingerprintQuery', () => {
    it('replaces literals with placeholders', () => {
      expect(fingerprintQuery('SELECT * FROM payments WHERE id = 42')).toBe(
        'select * from payments where id = ?',
      );
    });

    it('collapses whitespace and lowercases', () => {
      expect(fingerprintQuery('SELECT   *   FROM   Payments')).toBe('select * from payments');
    });

    it('produces the same signature for equivalent parametrised queries', () => {
      const a = fingerprintQuery("SELECT * FROM users WHERE email = 'a@x.com'");
      const b = fingerprintQuery("SELECT * FROM users WHERE email = 'b@y.com'");
      expect(a).toBe(b);
    });
  });

  describe('extractTable', () => {
    it('extracts the table from SELECT statements', () => {
      expect(extractTable('SELECT * FROM invoices WHERE id = ?')).toBe('invoices');
    });

    it('extracts the table from UPDATE statements', () => {
      expect(extractTable('UPDATE payments SET status = ? WHERE id = ?')).toBe('payments');
    });

    it('strips schema qualification', () => {
      expect(extractTable('SELECT * FROM public.audit_logs')).toBe('audit_logs');
    });

    it('returns null when no table can be found', () => {
      expect(extractTable('PRAGMA table_info')).toBeNull();
    });
  });

  describe('analyseQuery', () => {
    it('captures predicate and order-by columns', () => {
      const stats = analyseQuery(
        'SELECT * FROM payments WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC',
        { executions: 50, avgDurationMs: 120 },
      );
      expect(stats).not.toBeNull();
      expect(stats!.table).toBe('payments');
      expect(stats!.predicateColumns).toEqual(['tenant_id', 'status']);
      expect(stats!.orderByColumns).toEqual(['created_at']);
      expect(stats!.executions).toBe(50);
    });

    it('returns null for unparseable statements', () => {
      expect(analyseQuery('BEGIN')).toBeNull();
    });

    it('handles queries without a where clause', () => {
      const stats = analyseQuery('SELECT * FROM users ORDER BY created_at DESC');
      expect(stats!.predicateColumns).toEqual([]);
      expect(stats!.orderByColumns).toEqual(['created_at']);
    });
  });

  describe('recommendIndexes', () => {
    it('recommends a composite index leading with equality predicates', () => {
      const stats = analyseQuery(
        'SELECT * FROM payments WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC',
        { executions: 100, avgDurationMs: 200 },
      )!;
      const recs = recommendIndexes([stats]);
      expect(recs).toHaveLength(1);
      expect(recs[0].table).toBe('payments');
      expect(recs[0].columns).toEqual(['tenant_id', 'status', 'created_at']);
      expect(recs[0].score).toBeGreaterThan(0);
    });

    it('de-duplicates overlapping recommendations for the same table and columns', () => {
      const a = analyseQuery('SELECT * FROM users WHERE tenant_id = $1 AND email = $2', {
        executions: 10,
      })!;
      const b = analyseQuery('SELECT * FROM users WHERE tenant_id = $1 AND email = $2', {
        executions: 90,
      })!;
      const recs = recommendIndexes([a, b]);
      expect(recs).toHaveLength(1);
    });

    it('ignores queries without indexable columns', () => {
      const stats = analyseQuery('SELECT * FROM ping')!;
      expect(recommendIndexes([stats])).toHaveLength(0);
    });

    it('sorts recommendations by descending score', () => {
      const hot = analyseQuery('SELECT * FROM hot WHERE a = $1', {
        executions: 1000,
        avgDurationMs: 500,
      })!;
      const cold = analyseQuery('SELECT * FROM cold WHERE b = $1', {
        executions: 1,
        avgDurationMs: 1,
      })!;
      const recs = recommendIndexes([cold, hot]);
      expect(recs[0].table).toBe('hot');
    });
  });

  describe('detectFullTableScans', () => {
    it('flags frequent slow queries without predicates', () => {
      const scan = analyseQuery('SELECT * FROM audit_logs', {
        executions: 50,
        avgDurationMs: 300,
      })!;
      const indexed = analyseQuery('SELECT * FROM payments WHERE id = $1', {
        executions: 50,
        avgDurationMs: 300,
      })!;
      const flagged = detectFullTableScans([scan, indexed]);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].table).toBe('audit_logs');
    });

    it('respects custom thresholds', () => {
      const query = analyseQuery('SELECT * FROM t', { executions: 5, avgDurationMs: 50 })!;
      expect(detectFullTableScans([query])).toHaveLength(0);
      expect(detectFullTableScans([query], { minExecutions: 1, minAvgDurationMs: 1 })).toHaveLength(1);
    });
  });

  describe('consolidateByTable', () => {
    it('groups recommendations by table', () => {
      const a = analyseQuery('SELECT * FROM payments WHERE a = $1', { executions: 10 })!;
      const b = analyseQuery('SELECT * FROM invoices WHERE b = $1', { executions: 10 })!;
      const grouped = consolidateByTable(recommendIndexes([a, b]));
      expect(Object.keys(grouped).sort()).toEqual(['invoices', 'payments']);
    });
  });
});
