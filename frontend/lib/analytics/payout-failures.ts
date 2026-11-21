/**
 * payout-failures.ts — formatting helpers for the payout failure analytics
 * dashboard (Issue #939).
 *
 * The helpers are pure so they can be unit tested without a DOM.
 */

export type FailureSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface PayoutFailureRecord {
  id: string;
  payoutId: string;
  merchantId: string;
  asset: string;
  provider: string;
  amount: number;
  errorCode: string;
  errorMessage: string;
  attempt: number;
  occurredAt: string;
  severity: FailureSeverity;
  rootCause: string;
  resolutions: string[];
}

export interface PayoutFailureSummary {
  merchantId: string;
  asset: string;
  totalPayouts: number;
  failedPayouts: number;
  failureRate: number;
  totalAmount: number;
  failedAmount: number;
}

export interface PayoutFailureAnalytics {
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  failures: PayoutFailureRecord[];
  byErrorCode: Array<{ code: string; count: number }>;
  byMerchant: PayoutFailureSummary[];
  byAsset: PayoutFailureSummary[];
  byPeriod: Array<{
    period: string;
    totalPayouts: number;
    failedPayouts: number;
    failureRate: number;
    failedAmount: number;
  }>;
  totals: {
    totalPayouts: number;
    failedPayouts: number;
    completedPayouts: number;
    pendingPayouts: number;
    failureRate: number;
    totalAmount: number;
    failedAmount: number;
    settledAmount: number;
  };
}

/** Formats a percentage with one decimal, guarding against NaN. */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.0%';
  return `${value.toFixed(1)}%`;
}

/** Formats an amount with eight decimals, guarding against NaN. */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '0.00000000';
  return value.toFixed(8);
}

/** Maps a failure severity onto a badge variant. */
export function severityVariant(severity: FailureSeverity | string): 'destructive' | 'secondary' | 'default' {
  if (severity === 'critical' || severity === 'high') return 'destructive';
  if (severity === 'medium') return 'secondary';
  return 'default';
}

/** Builds the daily failure trend consumed by the dashboard chart. */
export function buildFailureTrend(analytics: PayoutFailureAnalytics | null): Array<{
  period: string;
  failures: number;
  failureRate: number;
}> {
  if (!analytics) return [];

  return analytics.byPeriod.map((period) => ({
    period: period.period,
    failures: period.failedPayouts,
    failureRate: period.failureRate,
  }));
}

/**
 * Builds the error-code breakdown with each code's share of all failures.
 */
export function buildErrorBreakdown(analytics: PayoutFailureAnalytics | null): Array<{
  code: string;
  count: number;
  share: number;
}> {
  if (!analytics) return [];

  const total = analytics.byErrorCode.reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0) return [];

  return analytics.byErrorCode.map((entry) => ({
    code: entry.code,
    count: entry.count,
    share: Number(((entry.count / total) * 100).toFixed(4)),
  }));
}

/** Sorts merchants by failure rate and keeps the worst performers first. */
export function rankMerchantsByFailureRate(
  analytics: PayoutFailureAnalytics | null,
  limit = 10,
): PayoutFailureSummary[] {
  if (!analytics) return [];

  return [...analytics.byMerchant]
    .sort((a, b) => b.failureRate - a.failureRate || b.failedPayouts - a.failedPayouts)
    .slice(0, limit);
}

/** Returns the ISO date (yyyy-mm-dd) for `days` before today. */
export function isoDateDaysAgo(days: number, now: Date = new Date()): string {
  const date = new Date(now.getTime());
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Returns today's date as an ISO date (yyyy-mm-dd). */
export function isoToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
