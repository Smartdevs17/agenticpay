/**
 * database.ts
 *
 * Database configuration, query profiling, connection pool tuning,
 * and recommended composite indexes for AgenticPay.
 */

import { featureFlags } from './featureFlags.js';

// ── Pool configuration ─────────────────────────────────────────────────────────

export interface PoolConfig {
  max: number;
  min: number;
  acquireTimeoutMs: number;
  idleTimeoutMs: number;
  createTimeoutMs: number;
  maxConnectionAgeMs: number;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  return v && !isNaN(Number(v)) ? Number(v) : fallback;
}

export function buildPoolConfig(env = process.env.NODE_ENV): PoolConfig {
  switch (env) {
    case 'production':
      return {
        max: envInt('DB_POOL_MAX', 50),
        min: envInt('DB_POOL_MIN', 5),
        acquireTimeoutMs: envInt('DB_ACQUIRE_TIMEOUT_MS', 10_000),
        idleTimeoutMs: envInt('DB_IDLE_TIMEOUT_MS', 300_000),
        createTimeoutMs: envInt('DB_CREATE_TIMEOUT_MS', 10_000),
        maxConnectionAgeMs: envInt('DB_MAX_AGE_MS', 1_800_000),
      };
    case 'staging':
      return {
        max: envInt('DB_POOL_MAX', 20),
        min: envInt('DB_POOL_MIN', 2),
        acquireTimeoutMs: 15_000,
        idleTimeoutMs: 600_000,
        createTimeoutMs: 15_000,
        maxConnectionAgeMs: 3_600_000,
      };
    default:
      return {
        max: envInt('DB_POOL_MAX', 10),
        min: envInt('DB_POOL_MIN', 1),
        acquireTimeoutMs: 30_000,
        idleTimeoutMs: 900_000,
        createTimeoutMs: 30_000,
        maxConnectionAgeMs: 7_200_000,
      };
  }
}

// ── Slow query detection ───────────────────────────────────────────────────────

export const SLOW_QUERY_THRESHOLD_MS = envInt('SLOW_QUERY_THRESHOLD_MS', 500);
export const VERY_SLOW_QUERY_THRESHOLD_MS = envInt('VERY_SLOW_QUERY_THRESHOLD_MS', 2_000);

export type SlowQuerySeverity = 'warn' | 'critical';

export interface SlowQueryEvent {
  sql: string;
  durationMs: number;
  severity: SlowQuerySeverity;
  params?: unknown[];
  timestamp: Date;
}

type SlowQueryHandler = (event: SlowQueryEvent) => void;

const slowQueryHandlers: SlowQueryHandler[] = [];

export function onSlowQuery(handler: SlowQueryHandler): void {
  slowQueryHandlers.push(handler);
}

export async function withQueryTimer<T>(
  sql: string,
  params: unknown[],
  execute: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    return await execute();
  } finally {
    const durationMs = Date.now() - start;
    if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
      const severity: SlowQuerySeverity =
        durationMs >= VERY_SLOW_QUERY_THRESHOLD_MS ? 'critical' : 'warn';
      const event: SlowQueryEvent = {
        sql: sql.slice(0, 500),
        durationMs,
        severity,
        params,
        timestamp: new Date(),
      };
      for (const handler of slowQueryHandlers) {
        try { handler(event); } catch { }
      }
    }
  }
}

onSlowQuery((event) => {
  const label = event.severity === 'critical' ? 'CRITICAL' : 'SLOW';
  console.warn(`[db] ${label} query ${event.durationMs}ms: ${event.sql.slice(0, 120)}`);
});

// ── Composite index definitions ────────────────────────────────────────────────

export interface CompositeIndex {
  name: string;
  table: string;
  columns: string[];
  description: string;
  targetQuery: string;
  unique?: boolean;
  partial?: string;
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
    name: 'idx_payments_tx_hash',
    table: 'payments',
    columns: ['tx_hash'],
    unique: true,
    description: 'Idempotency and on-chain lookup by transaction hash',
    targetQuery: 'SELECT * FROM payments WHERE tx_hash = ?',
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
  {
    name: 'idx_users_tenant_email',
    table: 'users',
    columns: ['tenant_id', 'email'],
    unique: true,
    description: 'Login and uniqueness constraint per tenant',
    targetQuery: 'SELECT * FROM users WHERE tenant_id = ? AND email = ?',
  },
  {
    name: 'idx_audit_logs_entity_created',
    table: 'audit_logs',
    columns: ['entity_id', 'created_at'],
    description: 'Audit trail queries per resource ordered by time',
    targetQuery: 'SELECT * FROM audit_logs WHERE entity_id = ? ORDER BY created_at DESC',
  },
  {
    name: 'idx_gas_estimates_network_recorded',
    table: 'gas_estimates',
    columns: ['network', 'recorded_at'],
    description: 'Gas analytics aggregation by network and time window',
    targetQuery: 'SELECT * FROM gas_estimates WHERE network = ? ORDER BY recorded_at DESC',
  },
];

export function getRecommendedIndexes(): CompositeIndex[] {
  if (!featureFlags.evaluate('db-composite-indexes')) return [];
  return RECOMMENDED_INDEXES;
}

// ── Prepared statement registry ───────────────────────────────────────────────

export const PREPARED_STATEMENTS = {
  getPaymentById: 'SELECT * FROM payments WHERE id = $1 AND tenant_id = $2 LIMIT 1',
  listPendingPayments:
    "SELECT id, tx_hash, amount, network FROM payments WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1",
  upsertGasEstimate: `
    INSERT INTO gas_estimates (network, gas_price_gwei, base_fee_gwei, recorded_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (network) DO UPDATE
      SET gas_price_gwei = EXCLUDED.gas_price_gwei,
          base_fee_gwei  = EXCLUDED.base_fee_gwei,
          recorded_at    = EXCLUDED.recorded_at
  `,
} as const;

export type PreparedStatementKey = keyof typeof PREPARED_STATEMENTS;

// ── Read replica routing ───────────────────────────────────────────────────────

export interface ReplicaConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function buildReplicaConfigs(): ReplicaConfig[] {
  const replicaUrls = (process.env.DB_READ_REPLICA_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return replicaUrls.map((url) => {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 5432,
      database: parsed.pathname.replace(/^\//, ''),
      user: parsed.username,
      password: parsed.password,
    };
  });
}

export function isReadQuery(sql: string): boolean {
  return /^\s*(SELECT|WITH\s)/i.test(sql);
}

// ── Query Profiler ────────────────────────────────────────────────────────────

export interface QueryProfile {
  query: string;
  durationMs: number;
  timestamp: string;
  source: string;
  rowsExamined?: number;
  rowsReturned?: number;
}

export interface NPlusOneDetection {
  source: string;
  parentQuery: string;
  childQueries: number;
  threshold: number;
  detectedAt: string;
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

  profile<T>(query: string, source: string, fn: () => Promise<T>): Promise<T> {
    if (!this.isEnabled()) return fn();

    const start = Date.now();
    return fn().then((result) => {
      const durationMs = Date.now() - start;
      const profile: QueryProfile = { query, durationMs, timestamp: new Date().toISOString(), source };

      this.allQueries.push(profile);
      if (this.allQueries.length > this.maxAllQueries) this.allQueries.shift();

      if (durationMs > this.slowThresholdMs) {
        console.warn(`[QueryProfiler] SLOW QUERY (${durationMs.toFixed(0)}ms) [${source}]: ${query.substring(0, 200)}`);
        this.slowQueries.push(profile);
        if (this.slowQueries.length > this.maxSlowQueries) this.slowQueries.shift();
      }

      return result;
    });
  }

  detectNPlusOne(source: string, parentFn: () => Promise<unknown[]>): Promise<unknown[]> {
    if (!this.isEnabled()) return parentFn();
    const originalQuery = this.allQueries[this.allQueries.length - 1]?.query || 'unknown';

    return parentFn().then((results) => {
      const total = this.allQueries.length;
      if (total > 10 && results.length > 1) {
        console.warn(`[QueryProfiler] N+1 DETECTED [${source}]: ${total} queries for ${results.length} results`);
        console.warn(`  Parent: ${originalQuery.substring(0, 150)}`);
      }
      return results;
    });
  }

  getSlowQueries(): QueryProfile[] { return [...this.slowQueries]; }

  getTopSlowQueries(n = 10): QueryProfile[] {
    return [...this.slowQueries].sort((a, b) => b.durationMs - a.durationMs).slice(0, n);
  }

  getAllQueries(): QueryProfile[] { return [...this.allQueries]; }

  getStats() {
    const total = this.allQueries.length;
    const slow = this.slowQueries.length;
    const avgDuration = total > 0 ? this.allQueries.reduce((sum, q) => sum + q.durationMs, 0) / total : 0;
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
