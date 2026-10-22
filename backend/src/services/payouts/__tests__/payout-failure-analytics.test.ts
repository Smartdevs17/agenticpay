import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPayoutHistory = vi.fn();

vi.mock('../payout-engine.js', () => ({
  payoutEngine: { getPayoutHistory },
}));

const { payoutFailureAnalyticsService } = await import('../payout-failure-analytics.js');

function batch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bat_1',
    idempotencyKey: 'idem_1',
    merchantId: 'merch_1',
    scheduleId: 'sch_1',
    cycleKey: 'cyc_1',
    status: 'completed',
    amount: 100,
    asset: 'USDC',
    transactionsCount: 1,
    attempts: 1,
    maxAttempts: 5,
    requiresApproval: false,
    fundsReleased: false,
    createdAt: new Date('2026-01-10T00:00:00.000Z'),
    updatedAt: new Date('2026-01-10T00:00:00.000Z'),
    ...overrides,
  };
}

const FILTERS = { tenantId: 'tenant_1', dateFrom: '2026-01-01', dateTo: '2026-01-31' };

describe('payoutFailureAnalyticsService.generateAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPayoutHistory.mockReturnValue([]);
  });

  it('returns an empty report when no payout was made', async () => {
    const analytics = await payoutFailureAnalyticsService.generateAnalytics(FILTERS);

    expect(analytics.totals).toMatchObject({
      totalPayouts: 0,
      failedPayouts: 0,
      completedPayouts: 0,
      failureRate: 0,
    });
    expect(analytics.failures).toEqual([]);
    expect(analytics.byMerchant).toEqual([]);
  });

  it('computes the failure rate against every payout, not only the failed ones', async () => {
    getPayoutHistory.mockReturnValue([
      batch({ id: 'bat_1', status: 'completed', amount: 100 }),
      batch({ id: 'bat_2', status: 'failed', amount: 50, errorMessage: 'insufficient funds' }),
    ]);

    const analytics = await payoutFailureAnalyticsService.generateAnalytics(FILTERS);

    expect(analytics.totals.totalPayouts).toBe(2);
    expect(analytics.totals.failedPayouts).toBe(1);
    expect(analytics.totals.completedPayouts).toBe(1);
    expect(analytics.totals.failureRate).toBe(50);
    expect(analytics.totals.totalAmount).toBe(150);
    expect(analytics.totals.failedAmount).toBe(50);

    expect(analytics.byMerchant).toHaveLength(1);
    expect(analytics.byMerchant[0]).toMatchObject({
      merchantId: 'merch_1',
      totalPayouts: 2,
      failedPayouts: 1,
      failureRate: 50,
      totalAmount: 150,
      failedAmount: 50,
    });
  });

  it('classifies the failure and explains the root cause', async () => {
    getPayoutHistory.mockReturnValue([
      batch({ status: 'failed', errorMessage: 'insufficient funds', attempts: 2 }),
    ]);

    const analytics = await payoutFailureAnalyticsService.generateAnalytics(FILTERS);

    expect(analytics.failures).toHaveLength(1);
    expect(analytics.failures[0]).toMatchObject({
      merchantId: 'merch_1',
      asset: 'USDC',
      amount: 100,
      errorCode: 'INSUFFICIENT_FUNDS',
      attempt: 2,
    });
    expect(analytics.failures[0].rootCause.length).toBeGreaterThan(0);
    expect(analytics.failures[0].resolutions.length).toBeGreaterThan(0);
    expect(analytics.byErrorCode).toEqual([{ code: 'INSUFFICIENT_FUNDS', count: 1 }]);
  });

  it('never mixes counts from a previous request', async () => {
    getPayoutHistory.mockReturnValue([batch({ status: 'failed', errorMessage: 'insufficient funds' })]);

    const first = await payoutFailureAnalyticsService.generateAnalytics(FILTERS);
    const second = await payoutFailureAnalyticsService.generateAnalytics(FILTERS);

    expect(first.byErrorCode).toEqual([{ code: 'INSUFFICIENT_FUNDS', count: 1 }]);
    expect(second.byErrorCode).toEqual([{ code: 'INSUFFICIENT_FUNDS', count: 1 }]);
  });

  it('breaks the results down per settlement asset and per day', async () => {
    getPayoutHistory.mockReturnValue([
      batch({ id: 'bat_1', status: 'failed', asset: 'USDC', errorMessage: 'insufficient funds' }),
      batch({
        id: 'bat_2',
        status: 'completed',
        asset: 'XLM',
        amount: 25,
        createdAt: new Date('2026-01-11T00:00:00.000Z'),
      }),
    ]);

    const analytics = await payoutFailureAnalyticsService.generateAnalytics(FILTERS);

    expect(analytics.byAsset.map((asset) => asset.asset).sort()).toEqual(['USDC', 'XLM']);
    expect(analytics.byAsset.find((asset) => asset.asset === 'USDC')).toMatchObject({
      totalPayouts: 1,
      failedPayouts: 1,
      failureRate: 100,
    });
    expect(analytics.byPeriod.map((period) => period.period)).toEqual(['2026-01-10', '2026-01-11']);
  });

  it('ignores payouts outside the requested window', async () => {
    getPayoutHistory.mockReturnValue([
      batch({ id: 'bat_1', status: 'failed', createdAt: new Date('2025-12-31T00:00:00.000Z') }),
      batch({ id: 'bat_2', status: 'failed', createdAt: new Date('2026-02-01T00:00:00.000Z') }),
    ]);

    const analytics = await payoutFailureAnalyticsService.generateAnalytics(FILTERS);

    expect(analytics.totals.totalPayouts).toBe(0);
    expect(analytics.failures).toEqual([]);
  });

  it('filters by merchant and by asset', async () => {
    getPayoutHistory.mockReturnValue([
      batch({ id: 'bat_1', merchantId: 'merch_1', asset: 'USDC', status: 'failed' }),
      batch({ id: 'bat_2', merchantId: 'merch_2', asset: 'XLM', status: 'failed' }),
    ]);

    const byAsset = await payoutFailureAnalyticsService.generateAnalytics({ ...FILTERS, asset: 'XLM' });
    expect(byAsset.totals.totalPayouts).toBe(1);
    expect(byAsset.failures[0].merchantId).toBe('merch_2');

    getPayoutHistory.mockReturnValue([
      batch({ id: 'bat_1', merchantId: 'merch_1', asset: 'USDC', status: 'failed' }),
      batch({ id: 'bat_2', merchantId: 'merch_2', asset: 'XLM', status: 'failed' }),
    ]);

    const byMerchant = await payoutFailureAnalyticsService.generateAnalytics({
      ...FILTERS,
      merchantId: 'merch_1',
    });
    expect(byMerchant.totals.totalPayouts).toBe(1);
    expect(byMerchant.failures[0].merchantId).toBe('merch_1');
  });

  it('rejects a reversed date range', async () => {
    await expect(
      payoutFailureAnalyticsService.generateAnalytics({
        ...FILTERS,
        dateFrom: '2026-02-01',
        dateTo: '2026-01-01',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
