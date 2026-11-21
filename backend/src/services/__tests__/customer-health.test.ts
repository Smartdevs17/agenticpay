import { describe, expect, it, beforeEach } from 'vitest';
import { CustomerHealthService } from '../customer-health.js';

describe('CustomerHealthService — Issue #855', () => {
  let service: CustomerHealthService;

  beforeEach(() => {
    service = new CustomerHealthService();
  });

  it('calculates healthy score for active customer', () => {
    const now = new Date('2026-01-15T00:00:00Z');
    for (let i = 0; i < 5; i++) {
      service.trackActivity({
        customerId: 'c1',
        type: 'payment_success',
        amount: 100,
        timestamp: new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000),
      });
    }
    for (let i = 0; i < 20; i++) {
      service.trackActivity({ customerId: 'c1', type: 'login', timestamp: new Date(now.getTime() - i * 24 * 60 * 60 * 1000) });
    }
    const health = service.getHealth('c1', now);
    expect(health.score).toBeGreaterThan(65);
    expect(['healthy', 'champion']).toContain(health.level);
    expect(health.factors).toHaveLength(5);
  });

  it('marks critical for churned customer', () => {
    const now = new Date('2026-01-15T00:00:00Z');
    service.trackActivity({ customerId: 'c2', type: 'payment_failed', timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) });
    service.trackActivity({ customerId: 'c2', type: 'payment_failed', timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) });
    service.trackActivity({ customerId: 'c2', type: 'subscription_cancelled', timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) });
    service.trackActivity({ customerId: 'c2', type: 'support_ticket_opened', timestamp: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) });

    const health = service.getHealth('c2', now);
    expect(health.score).toBeLessThan(40);
    expect(health.level).toBe('critical');
    expect(health.riskReasons.length).toBeGreaterThan(0);
    expect(health.recommendations.length).toBeGreaterThan(0);
  });

  it('recency scoring degrades over time', () => {
    const base = new Date('2026-01-01T00:00:00Z');
    service.trackActivity({ customerId: 'c3', type: 'payment_success', timestamp: base });
    const recent = service.getHealth('c3', new Date(base.getTime() + 2 * 24 * 60 * 60 * 1000));
    const stale = service.getHealth('c3', new Date(base.getTime() + 70 * 24 * 60 * 60 * 1000));
    expect(recent.score).toBeGreaterThan(stale.score);
  });

  it('at-risk detection', () => {
    const now = new Date('2026-01-15T00:00:00Z');
    // healthy
    service.trackActivity({ customerId: 'healthy1', type: 'payment_success', timestamp: now });
    service.trackActivity({ customerId: 'healthy1', type: 'login', timestamp: now });
    service.trackActivity({ customerId: 'healthy1', type: 'payment_success', timestamp: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000) });
    service.trackActivity({ customerId: 'healthy1', type: 'payment_success', timestamp: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) });
    // critical
    service.trackActivity({ customerId: 'risk1', type: 'payment_failed', timestamp: now });
    service.trackActivity({ customerId: 'risk1', type: 'subscription_cancelled', timestamp: now });

    const atRisk = service.listAtRisk(40, now);
    expect(atRisk.some((c) => c.customerId === 'risk1')).toBe(true);
  });

  it('distribution aggregates levels', () => {
    const now = new Date('2026-01-15T00:00:00Z');
    service.trackActivity({ customerId: 'a', type: 'payment_success', timestamp: now });
    service.trackActivity({ customerId: 'b', type: 'payment_failed', timestamp: now });
    service.trackActivity({ customerId: 'b', type: 'subscription_cancelled', timestamp: now });
    const dist = service.getDistribution(now);
    expect(dist.totalCustomers).toBe(2);
    expect(dist.averageScore).toBeGreaterThan(0);
    expect(dist.averageScore).toBeLessThanOrEqual(100);
  });

  it('tracks trend direction', () => {
    const base = new Date('2026-01-01T00:00:00Z');
    // declining: start healthy, then churn
    service.trackActivity({ customerId: 'trend1', type: 'payment_success', timestamp: base });
    service.getHealth('trend1', base);
    const later = new Date(base.getTime() + 10 * 24 * 60 * 60 * 1000);
    service.trackActivity({ customerId: 'trend1', type: 'payment_failed', timestamp: later });
    service.trackActivity({ customerId: 'trend1', type: 'payment_failed', timestamp: later });
    service.getHealth('trend1', later);
    const trend = service.getTrend('trend1');
    expect(['declining', 'stable']).toContain(trend.direction);
  });

  it('exports CSV', () => {
    const now = new Date('2026-01-15T00:00:00Z');
    service.trackActivity({ customerId: 'csv1', type: 'payment_success', timestamp: now });
    const csv = service.exportCsv(now);
    expect(csv).toContain('customerId,score,level');
    expect(csv).toContain('csv1');
  });

  it('handles no activity gracefully', () => {
    const health = service.getHealth('unknown');
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
    expect(health.level).toBeDefined();
  });

  it('support tickets reduce score', () => {
    const now = new Date('2026-01-15T00:00:00Z');
    service.trackActivity({ customerId: 'sup1', type: 'payment_success', timestamp: now });
    const baseScore = service.getHealth('sup1', now).score;
    // add many tickets
    for (let i = 0; i < 5; i++) service.trackActivity({ customerId: 'sup1', type: 'support_ticket_opened', timestamp: now });
    const after = service.calculateScore('sup1', now).score;
    expect(after).toBeLessThan(baseScore);
  });
});
