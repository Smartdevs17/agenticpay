/**
 * Per-tenant query budget accounting.
 *
 * The budget deliberately stores only tenant identifiers and aggregate timing;
 * SQL text and bound values never enter the accounting state. Callers can use
 * the returned classification to add an observation to their existing logger
 * or to reject a request before it starts another expensive query.
 */

export type QueryLatencyClass = 'normal' | 'slow' | 'critical';

export interface QueryBudgetConfig {
  /** Length of the accounting window in milliseconds. */
  windowMs: number;
  /** Maximum aggregate query time allowed per tenant in one window. */
  budgetMs: number;
  /** Duration at which a query is classified as slow. */
  slowThresholdMs: number;
  /** Duration at which a query is classified as critical. */
  criticalThresholdMs: number;
}

export interface QueryBudgetObservation {
  tenantId: string;
  durationMs: number;
  classification: QueryLatencyClass;
  consumedMs: number;
  remainingMs: number;
  withinBudget: boolean;
}

interface TenantWindow {
  startedAt: number;
  consumedMs: number;
}

const DEFAULT_CONFIG: QueryBudgetConfig = {
  windowMs: 60_000,
  budgetMs: 5_000,
  slowThresholdMs: 100,
  criticalThresholdMs: 2_000,
};

function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeConfig(config: Partial<QueryBudgetConfig>): QueryBudgetConfig {
  const slowThresholdMs = positiveFinite(config.slowThresholdMs ?? DEFAULT_CONFIG.slowThresholdMs, DEFAULT_CONFIG.slowThresholdMs);
  const criticalThresholdMs = Math.max(
    slowThresholdMs,
    positiveFinite(config.criticalThresholdMs ?? DEFAULT_CONFIG.criticalThresholdMs, DEFAULT_CONFIG.criticalThresholdMs),
  );
  return {
    windowMs: positiveFinite(config.windowMs ?? DEFAULT_CONFIG.windowMs, DEFAULT_CONFIG.windowMs),
    budgetMs: positiveFinite(config.budgetMs ?? DEFAULT_CONFIG.budgetMs, DEFAULT_CONFIG.budgetMs),
    slowThresholdMs,
    criticalThresholdMs,
  };
}

export class QueryBudget {
  private readonly config: QueryBudgetConfig;
  private readonly windows = new Map<string, TenantWindow>();

  constructor(config: Partial<QueryBudgetConfig> = {}) {
    this.config = normalizeConfig(config);
  }

  observe(tenantId: string, durationMs: number, now = Date.now()): QueryBudgetObservation {
    const safeTenantId = tenantId.trim() || 'unknown';
    const safeDurationMs = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    const existing = this.windows.get(safeTenantId);
    const window =
      !existing || now - existing.startedAt >= this.config.windowMs
        ? { startedAt: now, consumedMs: 0 }
        : existing;

    window.consumedMs += safeDurationMs;
    this.windows.set(safeTenantId, window);

    const classification: QueryLatencyClass =
      safeDurationMs >= this.config.criticalThresholdMs
        ? 'critical'
        : safeDurationMs >= this.config.slowThresholdMs
          ? 'slow'
          : 'normal';

    return {
      tenantId: safeTenantId,
      durationMs: safeDurationMs,
      classification,
      consumedMs: window.consumedMs,
      remainingMs: Math.max(0, this.config.budgetMs - window.consumedMs),
      withinBudget: window.consumedMs <= this.config.budgetMs,
    };
  }

  reset(tenantId?: string): void {
    if (tenantId === undefined) this.windows.clear();
    else this.windows.delete(tenantId.trim() || 'unknown');
  }
}

export const queryBudget = new QueryBudget({
  windowMs: Number(process.env.QUERY_BUDGET_WINDOW_MS),
  budgetMs: Number(process.env.QUERY_BUDGET_MS),
  slowThresholdMs: Number(process.env.QUERY_BUDGET_SLOW_MS),
  criticalThresholdMs: Number(process.env.QUERY_BUDGET_CRITICAL_MS),
});
