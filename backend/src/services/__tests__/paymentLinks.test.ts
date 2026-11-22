import { beforeEach, describe, expect, it } from 'vitest';
import {
  paymentLinksService,
  recordCheckoutEvent,
  getCheckoutAnalytics,
  getMerchantCheckoutSummary,
  resetCheckoutAnalyticsForTests,
} from '../paymentLinks.js';

describe('paymentLinks checkout analytics (#1358)', () => {
  beforeEach(() => {
    paymentLinksService.resetForTests();
    resetCheckoutAnalyticsForTests();
  });

  it('tracks views, checkout starts, completions, abandonments, and revenue', () => {
    const link = paymentLinksService.create({
      merchantId: 'merchant-1',
      title: 'Pro Plan',
      amount: 50,
      currency: 'USDC',
      branding: {
        brandName: 'Acme Pay',
        primaryColor: '#0ea5e9',
      },
    });

    recordCheckoutEvent(link.id, 'view', { source: 'twitter' });
    recordCheckoutEvent(link.id, 'view', { source: 'twitter' });
    recordCheckoutEvent(link.id, 'view', { source: 'email' });
    recordCheckoutEvent(link.id, 'checkout_started', { source: 'twitter' });
    recordCheckoutEvent(link.id, 'checkout_started', { source: 'email' });
    recordCheckoutEvent(link.id, 'abandoned', { source: 'email' });
    const stats = recordCheckoutEvent(link.id, 'completed', {
      source: 'twitter',
      amount: 50,
    });

    expect(stats.views).toBe(3);
    expect(stats.checkoutStarts).toBe(2);
    expect(stats.completions).toBe(1);
    expect(stats.abandonments).toBe(1);
    expect(stats.conversionRate).toBeCloseTo(1 / 3, 4);
    expect(stats.abandonmentRate).toBe(0.5);
    expect(stats.totalRevenue).toBe(50);
    expect(stats.averageOrderValue).toBe(50);
    expect(stats.topSource).toBe('twitter');
  });

  it('aggregates merchant checkout summary across links', () => {
    const linkA = paymentLinksService.create({
      merchantId: 'merchant-2',
      title: 'Starter',
      amount: 25,
      currency: 'USDC',
    });
    const linkB = paymentLinksService.create({
      merchantId: 'merchant-2',
      title: 'Enterprise',
      amount: 200,
      currency: 'USDC',
    });

    recordCheckoutEvent(linkA.id, 'view');
    recordCheckoutEvent(linkA.id, 'completed', { amount: 25 });
    recordCheckoutEvent(linkB.id, 'view');
    recordCheckoutEvent(linkB.id, 'view');
    recordCheckoutEvent(linkB.id, 'completed', { amount: 200 });

    const summary = getMerchantCheckoutSummary('merchant-2');
    expect(summary.totalLinks).toBe(2);
    expect(summary.activeLinks).toBe(2);
    expect(summary.totalViews).toBe(3);
    expect(summary.totalCompletions).toBe(2);
    expect(summary.totalRevenue).toBe(225);
    expect(summary.topPerformingLinkId).toBe(linkB.id);
  });

  it('throws on unknown link id or negative completion amount', () => {
    expect(() => getCheckoutAnalytics('missing-id')).toThrow(/not found/i);
    const link = paymentLinksService.create({
      merchantId: 'merchant-3',
      title: 'Donation',
      amount: null,
      currency: 'USDC',
    });
    expect(() =>
      recordCheckoutEvent(link.id, 'completed', { amount: -10 }),
    ).toThrow(/non-negative/i);
  });
});
