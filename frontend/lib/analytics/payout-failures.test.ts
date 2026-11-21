import { describe, expect, it } from 'vitest';
import {
  buildErrorBreakdown,
  buildFailureTrend,
  formatAmount,
  formatPercent,
  isoDateDaysAgo,
  isoToday,
  rankMerchantsByFailureRate,
  severityVariant,
  type PayoutFailureAnalytics,
} from './payout-failures';

function analytics(overrides: Partial<PayoutFailureAnalytics> = {}): PayoutFailureAnalytics {
  return {
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
    tenantId: 'tenant_1',
    failures: [],
    byErrorCode: [],
    byMerchant: [],
    byAsset: [],
    byPeriod: [],
    totals: {
      totalPayouts: 0,
      failedPayouts: 0,
      completedPayouts: 0,
      pendingPayouts: 0,
      failureRate: 0,
      totalAmount: 0,
      failedAmount: 0,
      settledAmount: 0,
    },
    ...overrides,
  };
}

describe('formatPercent', () => {
  it('formats a percentage with one decimal', () => {
    expect(formatPercent(12.345)).toBe('12.3%');
    expect(formatPercent(0)).toBe('0.0%');
  });

  it('never renders NaN', () => {
    expect(formatPercent(Number.NaN)).toBe('0.0%');
  });
});

describe('formatAmount', () => {
  it('formats an amount with eight decimals', () => {
    expect(formatAmount(1.5)).toBe('1.50000000');
    expect(formatAmount(Number.NaN)).toBe('0.00000000');
  });
});

describe('severityVariant', () => {
  it('maps severities onto badge variants', () => {
    expect(severityVariant('critical')).toBe('destructive');
    expect(severityVariant('high')).toBe('destructive');
    expect(severityVariant('medium')).toBe('secondary');
    expect(severityVariant('low')).toBe('default');
  });
});

describe('buildFailureTrend', () => {
  it('maps the daily periods onto chart points', () => {
    const points = buildFailureTrend(
      analytics({
        byPeriod: [
          { period: '2026-01-10', totalPayouts: 4, failedPayouts: 1, failureRate: 25, failedAmount: 10 },
        ],
      }),
    );

    expect(points).toEqual([{ period: '2026-01-10', failures: 1, failureRate: 25 }]);
  });

  it('returns an empty series when there is no analytics', () => {
    expect(buildFailureTrend(null)).toEqual([]);
  });
});

describe('buildErrorBreakdown', () => {
  it('computes the share of every error code', () => {
    const breakdown = buildErrorBreakdown(
      analytics({
        byErrorCode: [
          { code: 'INSUFFICIENT_FUNDS', count: 3 },
          { code: 'NETWORK_TIMEOUT', count: 1 },
        ],
      }),
    );

    expect(breakdown).toEqual([
      { code: 'INSUFFICIENT_FUNDS', count: 3, share: 75 },
      { code: 'NETWORK_TIMEOUT', count: 1, share: 25 },
    ]);
  });

  it('returns an empty breakdown when nothing failed', () => {
    expect(buildErrorBreakdown(analytics())).toEqual([]);
    expect(buildErrorBreakdown(null)).toEqual([]);
  });
});

describe('rankMerchantsByFailureRate', () => {
  it('sorts the worst performing merchants first and honours the limit', () => {
    const ranked = rankMerchantsByFailureRate(
      analytics({
        byMerchant: [
          { merchantId: 'a', asset: 'USDC', totalPayouts: 10, failedPayouts: 1, failureRate: 10, totalAmount: 1, failedAmount: 1 },
          { merchantId: 'b', asset: 'USDC', totalPayouts: 10, failedPayouts: 5, failureRate: 50, totalAmount: 1, failedAmount: 1 },
          { merchantId: 'c', asset: 'USDC', totalPayouts: 10, failedPayouts: 3, failureRate: 30, totalAmount: 1, failedAmount: 1 },
        ],
      }),
      2,
    );

    expect(ranked.map((merchant) => merchant.merchantId)).toEqual(['b', 'c']);
  });
});

describe('date helpers', () => {
  it('returns an ISO date for today and for a day in the past', () => {
    const now = new Date('2026-03-15T12:00:00.000Z');

    expect(isoToday(now)).toBe('2026-03-15');
    expect(isoDateDaysAgo(7, now)).toBe('2026-03-08');
  });
});
