/**
 * payout-failure-analytics.ts — Issue #939
 *
 * Payout failure analytics dashboard: classifies payout failures, computes
 * failure rates per merchant and per settlement asset, and surfaces the top
 * failure patterns for a date range.
 *
 * The payout ledger is the in-process `PayoutEngine` history. Each request
 * builds its own classifier so counts never leak between calls.
 */

import { FailureAnalytics, classifyFailure, type ErrorCode, type Severity } from '../failure-analysis.js';
import { payoutEngine } from './payout-engine.js';
import { AppError } from '../../middleware/errorHandler.js';

export interface PayoutFailureFilters {
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  merchantId?: string;
  asset?: string;
}

export interface FailureRecord {
  id: string;
  payoutId: string;
  merchantId: string;
  asset: string;
  provider: string;
  amount: number;
  errorCode: string;
  errorMessage: string;
  attempt: number;
  occurredAt: Date;
  txHash?: string;
  severity: Severity;
  rootCause: string;
  resolutions: string[];
}

export interface FailureSummary {
  period: string;
  merchantId: string;
  asset: string;
  provider: string;
  totalPayouts: number;
  failedPayouts: number;
  failureRate: number;
  totalAmount: number;
  failedAmount: number;
}

export interface FailurePeriodSummary {
  period: string;
  totalPayouts: number;
  failedPayouts: number;
  failureRate: number;
  failedAmount: number;
}

export interface PayoutFailureAnalytics {
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  failures: FailureRecord[];
  byErrorCode: Array<{ code: ErrorCode; count: number }>;
  byMerchant: FailureSummary[];
  byAsset: FailureSummary[];
  byPeriod: FailurePeriodSummary[];
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

/** Settlement rail used by the payout engine. */
const PAYOUT_PROVIDER = 'stellar';

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rate(failed: number, total: number): number {
  if (total <= 0) return 0;
  return Number(((failed / total) * 100).toFixed(4));
}

function emptySummary(overrides: Partial<FailureSummary>): FailureSummary {
  return {
    period: '',
    merchantId: '',
    asset: '',
    provider: PAYOUT_PROVIDER,
    totalPayouts: 0,
    failedPayouts: 0,
    failureRate: 0,
    totalAmount: 0,
    failedAmount: 0,
    ...overrides,
  };
}

export class PayoutFailureAnalyticsService {
  /**
   * Builds the analytics payload for a date range.
   *
   * Failure rates are computed against every payout in the window, not only
   * the failed ones, so the rate is a real rate and not always 100%.
   */
  async generateAnalytics(filters: PayoutFailureFilters): Promise<PayoutFailureAnalytics> {
    const { dateFrom, dateTo, tenantId, merchantId, asset } = filters;

    const from = new Date(`${dateFrom}T00:00:00.000Z`);
    const to = new Date(`${dateTo}T23:59:59.999Z`);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new AppError(400, 'dateFrom and dateTo must be valid ISO dates', 'VALIDATION_ERROR');
    }
    if (from.getTime() > to.getTime()) {
      throw new AppError(400, 'dateFrom must not be after dateTo', 'VALIDATION_ERROR');
    }

    const batches = payoutEngine.getPayoutHistory(merchantId);

    const filtered = batches.filter((batch) => {
      const created = batch.createdAt;
      if (created < from || created > to) return false;
      if (merchantId && batch.merchantId !== merchantId) return false;
      if (asset && batch.asset !== asset) return false;
      return true;
    });

    const analytics = new FailureAnalytics();
    const failures: FailureRecord[] = [];

    const merchantSummaries = new Map<string, FailureSummary>();
    const assetSummaries = new Map<string, FailureSummary>();
    const periodSummaries = new Map<string, FailurePeriodSummary>();

    let totalAmount = 0;
    let failedAmount = 0;
    let settledAmount = 0;
    let completedPayouts = 0;
    let pendingPayouts = 0;
    let failedPayouts = 0;

    for (const batch of filtered) {
      const amount = toNumber(batch.amount);
      const failed = batch.status === 'failed';
      const period = dayKey(batch.createdAt);

      totalAmount += amount;
      if (failed) {
        failedPayouts += 1;
        failedAmount += amount;
      } else if (batch.status === 'completed') {
        completedPayouts += 1;
        settledAmount += amount;
      } else {
        pendingPayouts += 1;
      }

      const merchantSummary =
        merchantSummaries.get(batch.merchantId) ??
        emptySummary({ merchantId: batch.merchantId, asset: batch.asset });
      merchantSummary.totalPayouts += 1;
      merchantSummary.totalAmount += amount;
      if (failed) {
        merchantSummary.failedPayouts += 1;
        merchantSummary.failedAmount += amount;
      }
      merchantSummary.failureRate = rate(merchantSummary.failedPayouts, merchantSummary.totalPayouts);
      merchantSummaries.set(batch.merchantId, merchantSummary);

      const assetSummary =
        assetSummaries.get(batch.asset) ?? emptySummary({ asset: batch.asset });
      assetSummary.totalPayouts += 1;
      assetSummary.totalAmount += amount;
      if (failed) {
        assetSummary.failedPayouts += 1;
        assetSummary.failedAmount += amount;
      }
      assetSummary.failureRate = rate(assetSummary.failedPayouts, assetSummary.totalPayouts);
      assetSummaries.set(batch.asset, assetSummary);

      const periodSummary =
        periodSummaries.get(period) ??
        ({ period, totalPayouts: 0, failedPayouts: 0, failureRate: 0, failedAmount: 0 } as FailurePeriodSummary);
      periodSummary.totalPayouts += 1;
      if (failed) {
        periodSummary.failedPayouts += 1;
        periodSummary.failedAmount += amount;
      }
      periodSummary.failureRate = rate(periodSummary.failedPayouts, periodSummary.totalPayouts);
      periodSummaries.set(period, periodSummary);

      if (!failed) continue;

      const errorMessage = batch.errorMessage ?? 'Batch failed';
      const classification = classifyFailure({
        errorMessage,
        txHash: batch.transactionHash,
      });
      analytics.analyse({ errorMessage, txHash: batch.transactionHash });

      failures.push({
        id: batch.id,
        payoutId: batch.id,
        merchantId: batch.merchantId,
        asset: batch.asset,
        provider: PAYOUT_PROVIDER,
        amount,
        errorCode: classification.code,
        errorMessage,
        attempt: batch.attempts,
        occurredAt: batch.createdAt,
        txHash: batch.transactionHash,
        severity: classification.severity,
        rootCause: classification.rootCause,
        resolutions: classification.resolutions,
      });
    }

    const byErrorCode = analytics.getTopFailures(20);
    const byMerchant = [...merchantSummaries.values()].sort(
      (a, b) => b.failureRate - a.failureRate || b.failedPayouts - a.failedPayouts,
    );
    const byAsset = [...assetSummaries.values()].sort(
      (a, b) => b.failureRate - a.failureRate || b.failedPayouts - a.failedPayouts,
    );
    const byPeriod = [...periodSummaries.values()].sort((a, b) => a.period.localeCompare(b.period));

    return {
      dateFrom,
      dateTo,
      tenantId,
      failures,
      byErrorCode,
      byMerchant,
      byAsset,
      byPeriod,
      totals: {
        totalPayouts: filtered.length,
        failedPayouts,
        completedPayouts,
        pendingPayouts,
        failureRate: rate(failedPayouts, filtered.length),
        totalAmount,
        failedAmount,
        settledAmount,
      },
    };
  }

  /** Resets the shared classifier state. Kept for API compatibility. */
  clearHistory(): void {
    // Each request builds its own classifier, so there is no shared state left
    // to clear. The method remains so existing callers keep working.
  }
}

export const payoutFailureAnalyticsService = new PayoutFailureAnalyticsService();
