import { featureFlags } from './featureFlags.js';

export interface QueryProfile {
  query: string;
  durationMs: number;
  timestamp: string;
  source: string;
  rowsExamined?: number;
  rowsReturned?: number;
}

export interface CompositeIndex {
  name: string;
  table: string;
  columns: string[];
  description: string;
  targetQuery: string;
  unique?: boolean;
}

export interface NPlusOneDetection {
  source: string;
  parentQuery: string;
  childQueries: number;
  threshold: number;
  detectedAt: string;
}

export const RECOMMENDED_INDEXES: CompositeIndex[] = [
  {
    name: 'idx_invoices_project_created',
    table: 'invoices',
    columns: ['project_id', 'created_at'],
    description: 'Optimizes listing invoices by project ordered by date',
    targetQuery: 'SELECT * FROM invoices WHERE project_id = ? ORDER BY created_at DESC',
  },
  {
    name: 'idx_verifications_status_type',
    table: 'verifications',
    columns: ['status', 'verification_type'],
    description: 'Filters verifications by status and type',
    targetQuery: 'SELECT * FROM verifications WHERE status = ? AND verification_type = ?',
  },
  {
    name: 'idx_transactions_account_ledger',
    table: 'transactions',
    columns: ['account_id', 'ledger_seq'],
    description: 'Looks up transactions for an account sorted by ledger sequence',
    targetQuery: 'SELECT * FROM transactions WHERE account_id = ? ORDER BY ledger_seq DESC',
  },
  {
    name: 'idx_payments_recipient_status',
    table: 'payments',
    columns: ['recipient', 'status'],
    description: 'Finds pending payments for a recipient',
    targetQuery: 'SELECT * FROM payments WHERE recipient = ? AND status = ?',
  },
  {
    name: 'idx_payments_created_status',
    table: 'payments',
    columns: ['created_at', 'status'],
    description: 'Oldest pending payments for processing',
    targetQuery: 'SELECT * FROM payments WHERE status = ? ORDER BY created_at ASC LIMIT ?',
  },
  {
    name: 'idx_sessions_user_expires',
    table: 'sessions',
    columns: ['user_id', 'expires_at'],
    description: 'Finds active sessions for a user',
    targetQuery: 'SELECT * FROM sessions WHERE user_id = ? AND expires_at > ?',
  },
  {
    name: 'idx_refunds_invoice_created',
    table: 'refunds',
    columns: ['invoice_id', 'created_at'],
    description: 'Lists refunds for an invoice ordered by date',
    targetQuery: 'SELECT * FROM refunds WHERE invoice_id = ? ORDER BY created_at DESC',
  },
];

export function getRecommendedIndexes(): CompositeIndex[] {
  if (!featureFlags.evaluate('db-composite-indexes')) return [];
  return RECOMMENDED_INDEXES;
}

class QueryProfiler {
  private slowQueries: QueryProfile[] = [];
  private allQueries: QueryProfile[] = [];
  private maxSlowQueries = 100;
  private maxAllQueries = 1000;

  private readonly slowThresholdMs: number;

  constructor(slowThresholdMs = 100) {
    this.slowThresholdMs = slowThresholdMs;
  }

  isEnabled(): boolean {
    return featureFlags.evaluate('db-query-profiling');
  }

  profile<T>(
    query: string,
    source: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!this.isEnabled()) return fn();

    const start = Date.now();
    return fn().then((result) => {
      const durationMs = Date.now() - start;
      const profile: QueryProfile = {
        query,
        durationMs,
        timestamp: new Date().toISOString(),
        source,
      };

      this.allQueries.push(profile);
      if (this.allQueries.length > this.maxAllQueries) {
        this.allQueries.shift();
      }

      if (durationMs > this.slowThresholdMs) {
        console.warn(`[QueryProfiler] SLOW QUERY (${durationMs.toFixed(0)}ms) [${source}]: ${query.substring(0, 200)}`);
        this.slowQueries.push(profile);
        if (this.slowQueries.length > this.maxSlowQueries) {
          this.slowQueries.shift();
        }
      }

      return result;
    });
  }

  detectNPlusOne(source: string, parentFn: () => Promise<unknown[]>): Promise<unknown[]> {
    if (!this.isEnabled()) return parentFn();

    const requestCount = new Map<string, number>();
    const originalQuery = this.allQueries[this.allQueries.length - 1]?.query || 'unknown';

    return parentFn().then((results) => {
      const childRequests = this.allQueries.length;
      const total = childRequests;

      if (total > 10 && results.length > 1) {
        const detection: NPlusOneDetection = {
          source,
          parentQuery: originalQuery,
          childQueries: total,
          threshold: 10,
          detectedAt: new Date().toISOString(),
        };
        console.warn(`[QueryProfiler] N+1 DETECTED [${source}]: ${total} queries for ${results.length} results`);
        console.warn(`  Parent: ${originalQuery.substring(0, 150)}`);
      }

      return results;
    });
  }

  getSlowQueries(): QueryProfile[] {
    return [...this.slowQueries];
  }

  getTopSlowQueries(n = 10): QueryProfile[] {
    return [...this.slowQueries]
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, n);
  }

  getAllQueries(): QueryProfile[] {
    return [...this.allQueries];
  }

  getStats() {
    const total = this.allQueries.length;
    const slow = this.slowQueries.length;
    const avgDuration = total > 0
      ? this.allQueries.reduce((sum, q) => sum + q.durationMs, 0) / total
      : 0;

    return {
      totalQueries: total,
      slowQueries: slow,
      slowPercentage: total > 0 ? (slow / total) * 100 : 0,
      avgDurationMs: avgDuration.toFixed(2),
      p95DurationMs: this.calculatePercentile(95),
      slowThresholdMs: this.slowThresholdMs,
    };
  }

  private calculatePercentile(pct: number): number {
    if (this.allQueries.length === 0) return 0;
    const sorted = [...this.allQueries].sort((a, b) => a.durationMs - b.durationMs);
    const idx = Math.ceil((pct / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)].durationMs;
  }

  reset(): void {
    this.slowQueries = [];
    this.allQueries = [];
  }
}

export const queryProfiler = new QueryProfiler(
  Number(process.env.DB_SLOW_QUERY_THRESHOLD_MS) || 100,
);

export async function withQueryProfiling<T>(
  query: string,
  source: string,
  fn: () => Promise<T>,
): Promise<T> {
  return queryProfiler.profile(query, source, fn);
}

export function getQueryProfiler(): QueryProfiler {
  return queryProfiler;
}
