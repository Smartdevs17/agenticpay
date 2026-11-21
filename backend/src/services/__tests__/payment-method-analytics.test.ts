// Payment method analytics service tests â€” Issue #942
import { describe, expect, it, beforeEach } from 'vitest';
import { PaymentMethodAnalyticsService } from '../payment-method-analytics.js';
const base = new Date('2026-01-01T00:00:00Z');
function days(d: number): Date { return new Date(base.getTime() + d * 24 * 60 * 60 * 1000); }

describe('PaymentMethodAnalyticsService â€” Issue #942', () => {
  let service: PaymentMethodAnalyticsService;
  beforeEach(() => { service = new PaymentMethodAnalyticsService(); });
  it('records usage events and computes per-method stats', () => {
    service.recordUsage({ method: 'card', amount: 100, status: 'success', timestamp: base });
    service.recordUsage({ method: 'card', amount: 200, status: 'failure', timestamp: days(1) });
    service.recordUsage({ method: 'card', amount: 300, status: 'success', timestamp: days(2) });
    service.recordUsage({ method: 'bank_account', amount: 500, status: 'success', timestamp: base });
    const card = service.getMethodStats('card');
    expect(card.method).toBe('card'); expect(card.usageCount).toBe(3); expect(card.successCount).toBe(2);
    expect(card.failureCount).toBe(1); expect(card.totalVolume).toBe(600); expect(card.successRate).toBeCloseTo(2 / 3);
    expect(card.averageTicket).toBe(200); expect(card.averageSuccessTicket).toBe(200);
    const ba = service.getMethodStats('bank_account'); expect(ba.successRate).toBe(1); expect(ba.averageTicket).toBe(500);
  });
  it('ranks methods by usage count in analytics', () => {
    service.recordUsage({ method: 'paypal', amount: 10, status: 'success', timestamp: base });
    service.recordUsage({ method: 'card', amount: 100, status: 'success', timestamp: base });
    service.recordUsage({ method: 'card', amount: 200, status: 'success', timestamp: base });
    const analytics = service.getAnalytics();
    expect(analytics.totalEvents).toBe(3); expect(analytics.topMethod!.method).toBe('card');
    expect(analytics.byMethod[0].method).toBe('card'); expect(analytics.byMethod[1].method).toBe('paypal');
    expect(analytics.overallSuccessRate).toBe(1);
  });
  it('handles unknown method gracefully', () => {
    const stats = service.getMethodStats('nonexistent');
    expect(stats.usageCount).toBe(0); expect(stats.successRate).toBe(0); expect(stats.lastUsed).toBeNull();
  });
  it('filters analytics by since date', () => {
    service.recordUsage({ method: 'card', amount: 100, status: 'success', timestamp: days(0) });
    service.recordUsage({ method: 'card', amount: 200, status: 'success', timestamp: days(10) });
    expect(service.getAnalytics().totalEvents).toBe(2);
    expect(service.getAnalytics({ since: days(5) }).totalEvents).toBe(1);
  });
  it('is read-only for analytics methods', () => {
    service.recordUsage({ method: 'card', amount: 100, status: 'success', timestamp: base });
    const before = service.list().length; service.getAnalytics(); expect(service.list().length).toBe(before);
  });
});
