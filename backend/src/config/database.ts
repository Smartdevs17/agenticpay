/**
 * database.ts
 *
 * Database configuration, query profiling, connection pool tuning,
 * PgBouncer integration, and recommended composite indexes for AgenticPay.
 */

import { featureFlags } from "./featureFlags.js";

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
    case "production":
      return {
        max: envInt("DB_POOL_MAX", 50),
        min: envInt("DB_POOL_MIN", 5),
        acquireTimeoutMs: envInt("DB_ACQUIRE_TIMEOUT_MS", 10_000),
        idleTimeoutMs: envInt("DB_IDLE_TIMEOUT_MS", 300_000),
        createTimeoutMs: envInt("DB_CREATE_TIMEOUT_MS", 10_000),
        maxConnectionAgeMs: envInt("DB_MAX_AGE_MS", 1_800_000),
      };
    case "staging":
      return {
        max: envInt("DB_POOL_MAX", 20),
        min: envInt("DB_POOL_MIN", 2),
        acquireTimeoutMs: 15_000,
        idleTimeoutMs: 600_000,
        createTimeoutMs: 15_000,
        maxConnectionAgeMs: 3_600_000,
      };
    default:
      return {
        max: envInt("DB_POOL_MAX", 10),
        min: envInt("DB_POOL_MIN", 1),
        acquireTimeoutMs: 30_000,
        idleTimeoutMs: 900_000,
        createTimeoutMs: 30_000,
        maxConnectionAgeMs: 7_200_000,
      };
  }
}

// ── PgBouncer Integration ─────────────────────────────────────────────────────

export interface PgBouncerConfig {
  enabled: boolean;
  poolMode: "transaction" | "session" | "statement";
  defaultPoolSize: number;
  maxPoolSize: number;
  minPoolSize: number;
  reservePoolSize: number;
  reservePoolTimeoutMs: number;
  maxClientConnections: number;
  maxPreparedStatements: number;
  queryTimeoutMs: number;
  idleTimeoutMs: number;
  serverLifetimeMs: number;
  serverIdleTimeoutMs: number;
  healthCheckIntervalMs: number;
}

const DEFAULT_PGBOUNCER_CONFIG: PgBouncerConfig = {
  enabled: process.env.PGBOUNCER_ENABLED === "true",
  poolMode: "transaction",
  defaultPoolSize: envInt("PGBOUNCER_DEFAULT_POOL_SIZE", 25),
  maxPoolSize: envInt("PGBOUNCER_MAX_POOL_SIZE", 50),
  minPoolSize: envInt("PGBOUNCER_MIN_POOL_SIZE", 5),
  reservePoolSize: envInt("PGBOUNCER_RESERVE_POOL_SIZE", 5),
  reservePoolTimeoutMs: envInt("PGBOUNCER_RESERVE_POOL_TIMEOUT_MS", 5_000),
  maxClientConnections: envInt("PGBOUNCER_MAX_CLIENT_CONNECTIONS", 100),
  maxPreparedStatements: envInt("PGBOUNCER_MAX_PREPARED_STATEMENTS", 50),
  queryTimeoutMs: envInt("PGBOUNCER_QUERY_TIMEOUT_MS", 30_000),
  idleTimeoutMs: envInt("PGBOUNCER_IDLE_TIMEOUT_MS", 600_000),
  serverLifetimeMs: envInt("PGBOUNCER_SERVER_LIFETIME_MS", 3_600_000),
  serverIdleTimeoutMs: envInt("PGBOUNCER_SERVER_IDLE_TIMEOUT_MS", 600_000),
  healthCheckIntervalMs: envInt("PGBOUNCER_HEALTH_CHECK_INTERVAL_MS", 30_000),
};

let pgBouncerConfig: PgBouncerConfig = { ...DEFAULT_PGBOUNCER_CONFIG };

export function configurePgBouncer(config: Partial<PgBouncerConfig>): void {
  pgBouncerConfig = { ...pgBouncerConfig, ...config };
}

export function getPgBouncerConfig(): PgBouncerConfig {
  return { ...pgBouncerConfig };
}

// ── Pool Metrics ──────────────────────────────────────────────────────────────

interface ConnectionPoolMetrics {
  activeConnections: number;
  idleConnections: number;
  waitingClients: number;
  totalConnections: number;
  maxConnections: number;
  minConnections: number;
  connectionLeasesTotal: number;
  connectionLeasesActive: number;
  connectionLeasesReleased: number;
  connectionLeaseErrors: number;
  leakedConnectionsDetected: number;
  poolExhaustionCount: number;
  averageAcquireTimeMs: number;
  peakActiveConnections: number;
  timestamp: string;
}

class PoolMetricsCollector {
  private activeConnections = 0;
  private idleConnections = 0;
  private waitingClients = 0;
  private totalConnections = 0;
  private connectionLeasesTotal = 0;
  private connectionLeasesActive = 0;
  private connectionLeasesReleased = 0;
  private connectionLeaseErrors = 0;
  private leakedConnectionsDetected = 0;
  private poolExhaustionCount = 0;
  private acquireTimes: number[] = [];
  private peakActiveConnections = 0;
  private maxConnections = 50;
  private minConnections = 5;
  private readonly maxAcquireTimeSamples = 100;

  setPoolLimits(max: number, min: number): void {
    this.maxConnections = max;
    this.minConnections = min;
  }

  recordConnectionAcquired(durationMs: number): void {
    this.activeConnections++;
    this.totalConnections++;
    this.connectionLeasesTotal++;
    this.connectionLeasesActive++;
    this.acquireTimes.push(durationMs);
    if (this.acquireTimes.length > this.maxAcquireTimeSamples) {
      this.acquireTimes.shift();
    }
    if (this.activeConnections > this.peakActiveConnections) {
      this.peakActiveConnections = this.activeConnections;
    }
  }

  recordConnectionReleased(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    this.connectionLeasesActive = Math.max(0, this.connectionLeasesActive - 1);
    this.connectionLeasesReleased++;
  }

  recordConnectionIdle(): void {
    this.idleConnections++;
  }

  recordWaitingClient(): void {
    this.waitingClients++;
  }

  recordPoolExhaustion(): void {
    this.poolExhaustionCount++;
  }

  recordLeakDetected(): void {
    this.leakedConnectionsDetected++;
  }

  recordLeaseError(): void {
    this.connectionLeaseErrors++;
  }

  snapshot(): ConnectionPoolMetrics {
    const averageAcquireTimeMs =
      this.acquireTimes.length > 0
        ? this.acquireTimes.reduce((sum, t) => sum + t, 0) /
          this.acquireTimes.length
        : 0;

    return {
      activeConnections: this.activeConnections,
      idleConnections: this.idleConnections,
      waitingClients: this.waitingClients,
      totalConnections: this.totalConnections,
      maxConnections: this.maxConnections,
      minConnections: this.minConnections,
      connectionLeasesTotal: this.connectionLeasesTotal,
      connectionLeasesActive: this.connectionLeasesActive,
      connectionLeasesReleased: this.connectionLeasesReleased,
      connectionLeaseErrors: this.connectionLeaseErrors,
      leakedConnectionsDetected: this.leakedConnectionsDetected,
      poolExhaustionCount: this.poolExhaustionCount,
      averageAcquireTimeMs: Math.round(averageAcquireTimeMs * 100) / 100,
      peakActiveConnections: this.peakActiveConnections,
      timestamp: new Date().toISOString(),
    };
  }

  reset(): void {
    this.activeConnections = 0;
    this.idleConnections = 0;
    this.waitingClients = 0;
    this.totalConnections = 0;
    this.connectionLeasesTotal = 0;
    this.connectionLeasesActive = 0;
    this.connectionLeasesReleased = 0;
    this.connectionLeaseErrors = 0;
    this.leakedConnectionsDetected = 0;
    this.poolExhaustionCount = 0;
    this.acquireTimes = [];
    this.peakActiveConnections = 0;
  }
}

export const poolMetrics = new PoolMetricsCollector();

// ── Connection Lease Manager ───────────────────────────────────────────────────

interface ConnectionLease {
  id: string;
  acquiredAt: number;
  released: boolean;
}

class ConnectionLeaseManager {
  private leases = new Map<string, ConnectionLease>();
  private readonly leaseTimeoutMs: number;
  private leakCheckInterval?: ReturnType<typeof setInterval>;

  constructor(leaseTimeoutMs = 300_000) {
    this.leaseTimeoutMs = leaseTimeoutMs;
  }

  startLeakDetection(): void {
    if (this.leakCheckInterval) return;
    this.leakCheckInterval = setInterval(() => {
      this.detectLeaks();
    }, 60_000);
  }

  stopLeakDetection(): void {
    if (this.leakCheckInterval) {
      clearInterval(this.leakCheckInterval);
      this.leakCheckInterval = undefined;
    }
  }

  acquire(id: string): void {
    this.leases.set(id, { id, acquiredAt: Date.now(), released: false });
  }

  release(id: string): void {
    const lease = this.leases.get(id);
    if (lease) {
      lease.released = true;
    }
  }

  private detectLeaks(): void {
    const now = Date.now();
    for (const [id, lease] of this.leases.entries()) {
      if (!lease.released && now - lease.acquiredAt > this.leaseTimeoutMs) {
        console.warn(
          `[PoolLeak] Connection ${id} has been held for ${now - lease.acquiredAt}ms without release`,
        );
        poolMetrics.recordLeakDetected();
        this.leases.delete(id);
      } else if (lease.released) {
        if (now - lease.acquiredAt > 60_000) {
          this.leases.delete(id);
        }
      }
    }
  }

  getActiveLeaseCount(): number {
    let count = 0;
    for (const lease of this.leases.values()) {
      if (!lease.released) count++;
    }
    return count;
  }
}

export const connectionLeaseManager = new ConnectionLeaseManager();
connectionLeaseManager.startLeakDetection();

// ── Pool Exhaustion Handler ────────────────────────────────────────────────────

interface PoolExhaustionHandler {
  onExhaustion: () => void;
  onRecovery: () => void;
  backoffMs: number;
  maxBackoffMs: number;
}

class PoolExhaustionManager {
  private handlers: PoolExhaustionHandler[] = [];
  private isExhausted = false;
  private backoffMs = 100;
  private readonly maxBackoffMs = 10_000;
  private recoveryTimer?: ReturnType<typeof setTimeout>;

  registerHandler(handler: Partial<PoolExhaustionHandler>): void {
    this.handlers.push({
      onExhaustion: handler.onExhaustion ?? (() => {}),
      onRecovery: handler.onRecovery ?? (() => {}),
      backoffMs: handler.backoffMs ?? this.backoffMs,
      maxBackoffMs: handler.maxBackoffMs ?? this.maxBackoffMs,
    });
  }

  notifyExhaustion(): void {
    poolMetrics.recordPoolExhaustion();
    this.isExhausted = true;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);

    for (const handler of this.handlers) {
      try {
        handler.onExhaustion();
      } catch {}
    }

    console.warn(
      `[PoolExhaustion] Pool exhausted, backing off for ${this.backoffMs}ms`,
    );
  }

  notifyRecovery(): void {
    this.isExhausted = false;
    this.backoffMs = 100;

    for (const handler of this.handlers) {
      try {
        handler.onRecovery();
      } catch {}
    }

    console.log("[PoolExhaustion] Pool recovered");
  }

  scheduleRecovery(): void {
    if (this.recoveryTimer) return;
    this.recoveryTimer = setTimeout(() => {
      this.notifyRecovery();
      this.recoveryTimer = undefined;
    }, this.backoffMs);
  }

  isPoolExhausted(): boolean {
    return this.isExhausted;
  }

  getBackoffMs(): number {
    return this.backoffMs;
  }
}

export const poolExhaustionManager = new PoolExhaustionManager();

// ── Prepared Statement Registry ────────────────────────────────────────────────

export const PREPARED_STATEMENTS = {
  getPaymentById:
    "SELECT * FROM payments WHERE id = $1 AND tenant_id = $2 LIMIT 1",
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

class PreparedStatementManager {
  private statements = new Map<string, string>();
  private maxStatements: number;
  private deallocateOnError = true;

  constructor(maxStatements = 50) {
    this.maxStatements = maxStatements;
  }

  register(name: string, sql: string): void {
    if (this.statements.size >= this.maxStatements) {
      const oldestKey = this.statements.keys().next().value;
      if (oldestKey !== undefined) {
        this.statements.delete(oldestKey as string);
      }
    }
    this.statements.set(name, sql);
  }

  get(name: string): string | undefined {
    return this.statements.get(name);
  }

  registerDefaults(): void {
    for (const [name, sql] of Object.entries(PREPARED_STATEMENTS)) {
      this.register(name, sql);
    }
  }

  deallocate(name: string): void {
    this.statements.delete(name);
  }

  deallocateAll(): void {
    this.statements.clear();
  }

  getRegisteredStatements(): Array<{ name: string; sql: string }> {
    return Array.from(this.statements.entries()).map(([name, sql]) => ({
      name,
      sql,
    }));
  }

  getStatementCount(): number {
    return this.statements.size;
  }
}

export const preparedStatementManager = new PreparedStatementManager(
  envInt("PGBOUNCER_MAX_PREPARED_STATEMENTS", 50),
);
preparedStatementManager.registerDefaults();

// ── Slow query detection ───────────────────────────────────────────────────────

export const SLOW_QUERY_THRESHOLD_MS = envInt("SLOW_QUERY_THRESHOLD_MS", 500);
export const VERY_SLOW_QUERY_THRESHOLD_MS = envInt(
  "VERY_SLOW_QUERY_THRESHOLD_MS",
  2_000,
);

export type SlowQuerySeverity = "warn" | "critical";

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
  execute: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await execute();
  } finally {
    const durationMs = Date.now() - start;
    if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
      const severity: SlowQuerySeverity =
        durationMs >= VERY_SLOW_QUERY_THRESHOLD_MS ? "critical" : "warn";
      const event: SlowQueryEvent = {
        sql: sql.slice(0, 500),
        durationMs,
        severity,
        params,
        timestamp: new Date(),
      };
      for (const handler of slowQueryHandlers) {
        try {
          handler(event);
        } catch {}
      }
    }
  }
}

onSlowQuery((event) => {
  const label = event.severity === "critical" ? "CRITICAL" : "SLOW";
  console.warn(
    `[db] ${label} query ${event.durationMs}ms: ${event.sql.slice(0, 120)}`,
  );
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
    name: "idx_invoices_project_created",
    table: "invoices",
    columns: ["project_id", "created_at"],
    description: "Optimizes listing invoices by project ordered by date",
    targetQuery:
      "SELECT * FROM invoices WHERE project_id = ? ORDER BY created_at DESC",
  },
  {
    name: "idx_verifications_status_type",
    table: "verifications",
    columns: ["status", "verification_type"],
    description: "Filters verifications by status and type",
    targetQuery:
      "SELECT * FROM verifications WHERE status = ? AND verification_type = ?",
  },
  {
    name: "idx_transactions_account_ledger",
    table: "transactions",
    columns: ["account_id", "ledger_seq"],
    description:
      "Looks up transactions for an account sorted by ledger sequence",
    targetQuery:
      "SELECT * FROM transactions WHERE account_id = ? ORDER BY ledger_seq DESC",
  },
  {
    name: "idx_payments_recipient_status",
    table: "payments",
    columns: ["recipient", "status"],
    description: "Finds pending payments for a recipient",
    targetQuery: "SELECT * FROM payments WHERE recipient = ? AND status = ?",
  },
  {
    name: "idx_payments_created_status",
    table: "payments",
    columns: ["created_at", "status"],
    description: "Oldest pending payments for processing",
    targetQuery:
      "SELECT * FROM payments WHERE status = ? ORDER BY created_at ASC LIMIT ?",
  },
  {
    name: "idx_payments_tx_hash",
    table: "payments",
    columns: ["tx_hash"],
    unique: true,
    description: "Idempotency and on-chain lookup by transaction hash",
    targetQuery: "SELECT * FROM payments WHERE tx_hash = ?",
  },
  {
    name: "idx_sessions_user_expires",
    table: "sessions",
    columns: ["user_id", "expires_at"],
    description: "Finds active sessions for a user",
    targetQuery: "SELECT * FROM sessions WHERE user_id = ? AND expires_at > ?",
  },
  {
    name: "idx_refunds_invoice_created",
    table: "refunds",
    columns: ["invoice_id", "created_at"],
    description: "Lists refunds for an invoice ordered by date",
    targetQuery:
      "SELECT * FROM refunds WHERE invoice_id = ? ORDER BY created_at DESC",
  },
  {
    name: "idx_users_tenant_email",
    table: "users",
    columns: ["tenant_id", "email"],
    unique: true,
    description: "Login and uniqueness constraint per tenant",
    targetQuery: "SELECT * FROM users WHERE tenant_id = ? AND email = ?",
  },
  {
    name: "idx_audit_logs_entity_created",
    table: "audit_logs",
    columns: ["entity_id", "created_at"],
    description: "Audit trail queries per resource ordered by time",
    targetQuery:
      "SELECT * FROM audit_logs WHERE entity_id = ? ORDER BY created_at DESC",
  },
  {
    name: "idx_gas_estimates_network_recorded",
    table: "gas_estimates",
    columns: ["network", "recorded_at"],
    description: "Gas analytics aggregation by network and time window",
    targetQuery:
      "SELECT * FROM gas_estimates WHERE network = ? ORDER BY recorded_at DESC",
  },
];

export function getRecommendedIndexes(): CompositeIndex[] {
  if (!featureFlags.evaluate("db-composite-indexes")) return [];
  return RECOMMENDED_INDEXES;
}

// ── Read replica routing ───────────────────────────────────────────────────────

export interface ReplicaConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  enabled: boolean;
  maxLag: number;
}

export function buildReplicaConfigs(): ReplicaConfig[] {
  const replicaUrls = (process.env.DB_READ_REPLICA_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const maxLag = envInt("DB_REPLICA_MAX_LAG_MS", 5000);

  return replicaUrls.map((url) => {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 5432,
      database: parsed.pathname.replace(/^\//, ""),
      user: parsed.username,
      password: parsed.password,
      enabled: true,
      maxLag,
    };
  });
}

export function buildReplicaUrls(): string[] {
  return (process.env.DB_READ_REPLICA_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
    return featureFlags.evaluate("db-query-profiling");
  }

  profile<T>(query: string, source: string, fn: () => Promise<T>): Promise<T> {
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
      if (this.allQueries.length > this.maxAllQueries) this.allQueries.shift();

      if (durationMs > this.slowThresholdMs) {
        console.warn(
          `[QueryProfiler] SLOW QUERY (${durationMs.toFixed(0)}ms) [${source}]: ${query.substring(0, 200)}`,
        );
        this.slowQueries.push(profile);
        if (this.slowQueries.length > this.maxSlowQueries)
          this.slowQueries.shift();
      }

      return result;
    });
  }

  detectNPlusOne(
    source: string,
    parentFn: () => Promise<unknown[]>,
  ): Promise<unknown[]> {
    if (!this.isEnabled()) return parentFn();
    const originalQuery =
      this.allQueries[this.allQueries.length - 1]?.query || "unknown";

    return parentFn().then((results) => {
      const total = this.allQueries.length;
      if (total > 10 && results.length > 1) {
        console.warn(
          `[QueryProfiler] N+1 DETECTED [${source}]: ${total} queries for ${results.length} results`,
        );
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
    const avgDuration =
      total > 0
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
    const sorted = [...this.allQueries].sort(
      (a, b) => a.durationMs - b.durationMs,
    );
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
