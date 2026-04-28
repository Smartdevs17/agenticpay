/**
 * database.ts — Issue #214
 *
 * Database query optimisation configuration and connection pool tuning.
 * Provides:
 *  - Connection pool sizing based on environment
 *  - Slow query detection thresholds and alerting hooks
 *  - Query execution plan helpers (EXPLAIN wrapper)
 *  - Recommended index definitions for common query patterns
 *  - Prepared statement registry for high-frequency queries
 */

// ── Pool configuration ─────────────────────────────────────────────────────────

export interface PoolConfig {
  /** Maximum concurrent connections in the pool. */
  max: number;
  /** Minimum idle connections to keep warm. */
  min: number;
  /** ms to wait for a free connection before throwing (acquire timeout). */
  acquireTimeoutMs: number;
  /** ms an idle connection may sit before being closed. */
  idleTimeoutMs: number;
  /** ms the pool will try to create a connection before failing. */
  createTimeoutMs: number;
  /** Reap connections older than this (ms), regardless of idle state. */
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
        idleTimeoutMs: envInt('DB_IDLE_TIMEOUT_MS', 300_000),    // 5 min
        createTimeoutMs: envInt('DB_CREATE_TIMEOUT_MS', 10_000),
        maxConnectionAgeMs: envInt('DB_MAX_AGE_MS', 1_800_000),  // 30 min
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

/**
 * Wrap a database query function to track execution time and fire slow-query
 * alerts when thresholds are exceeded.
 *
 * ```ts
 * const rows = await withQueryTimer('SELECT * FROM payments WHERE id = $1', [id], () =>
 *   db.query('SELECT * FROM payments WHERE id = $1', [id])
 * );
 * ```
 */
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
        try { handler(event); } catch { /* never let alerting break the query path */ }
      }
    }
  }
}

// ── Default slow-query handler (console logging) ──────────────────────────────

onSlowQuery((event) => {
  const label = event.severity === 'critical' ? '🔴 CRITICAL' : '🟡 SLOW';
  console.warn(
    `[db] ${label} query ${event.durationMs}ms: ${event.sql.slice(0, 120)}…`
  );
});

// ── Recommended index definitions ─────────────────────────────────────────────

export interface IndexDefinition {
  table: string;
  columns: string[];
  unique?: boolean;
  partial?: string; // WHERE clause
  reason: string;
}

/**
 * Indexes that should exist for common AgenticPay query patterns.
 * Use these definitions to generate migration scripts.
 */
export const RECOMMENDED_INDEXES: IndexDefinition[] = [
  {
    table: 'payments',
    columns: ['tenant_id', 'created_at'],
    reason: 'Hot path: list payments by tenant ordered by date',
  },
  {
    table: 'payments',
    columns: ['status'],
    partial: "WHERE status IN ('pending', 'processing')",
    reason: 'Background job: poll for non-terminal payments',
  },
  {
    table: 'payments',
    columns: ['tx_hash'],
    unique: true,
    reason: 'Idempotency and on-chain lookup by transaction hash',
  },
  {
    table: 'users',
    columns: ['tenant_id', 'email'],
    unique: true,
    reason: 'Login and uniqueness constraint per tenant',
  },
  {
    table: 'audit_logs',
    columns: ['entity_id', 'created_at'],
    reason: 'Audit trail queries per resource ordered by time',
  },
  {
    table: 'gas_estimates',
    columns: ['network', 'recorded_at'],
    reason: 'Gas analytics aggregation by network and time window',
  },
];

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

/** Returns true if the query is safe to route to a read replica. */
export function isReadQuery(sql: string): boolean {
  return /^\s*(SELECT|WITH\s)/i.test(sql);
}
