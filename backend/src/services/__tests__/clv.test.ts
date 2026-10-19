// Customer Lifetime Value service tests â€” Issue #943
import { describe, expect, it, beforeEach } from 'vitest';
import { CLVService } from '../clv.js';
const base = new Date('2026-01-01T00:00:00Z');
function daysFromBase(days: number): Date { return new Date(base.getTime() + days * 24 * 60 * 60 * 1000); }

describe('CLVService â€” Issue #943', () => {
  let service: CLVService;
  beforeEach(() => { service = new CLVService(); });
  it('computes CLV for a customer with repeat purchases', () => {
    const now = daysFromBase(60);
    service.recordPayment({ customerId: 'c1', amount: 100, status: 'completed', timestamp: base });
    service.recordPayment({ customerId: 'c1', amount: 200, status: 'completed', timestamp: daysFromBase(30) });
    service.recordPayment({ customerId: 'c1', amount: 300, status: 'completed', timestamp: daysFromBase(60) });
    const clv = service.getCLV('c1', now);
    expect(clv.totalSpend).toBe(600); expect(clv.orderCount).toBe(3); expect(clv.averageOrderValue).toBe(200);
    expect(clv.lifespanMonths).toBeCloseTo(2, 1); expect(clv.clv).toBeCloseTo(600, 1); expect(clv.tier).toBe('gold');
  });
  it('returns zero CLV for a customer with no completed payments', () => {
    service.recordPayment({ customerId: 'c1', amount: 100, status: 'failed' });
    const clv = service.getCLV('c1'); expect(clv.orderCount).toBe(0); expect(clv.clv).toBe(0); expect(clv.tier).toBe('bronze');
  });
  it('ranks customers by CLV in dashboard', () => {
    const now = daysFromBase(30);
    service.recordPayment({ customerId: 'low', amount: 10, status: 'completed', timestamp: base });
    service.recordPayment({ customerId: 'high', amount: 5000, status: 'completed', timestamp: base });
    const dash = service.dashboard({ asOf: now });
    expect(dash.totalCustomers).toBe(2); expect(dash.topCustomers[0].customerId).toBe('high');
    expect(dash.topCustomers[0].clv).toBeGreaterThan(dash.topCustomers[1].clv);
    expect(dash.totalSpend).toBe(5010); expect(dash.averageCLV).toBeGreaterThan(0); expect(dash.medianCLV).toBeGreaterThan(0);
  });
  it('distributes customers into tiers', () => {
    service.recordPayment({ customerId: 'p1', amount: 12000, status: 'completed', timestamp: base });
    service.recordPayment({ customerId: 'p2', amount: 200, status: 'completed', timestamp: base });
    const dash = service.dashboard(); expect(dash.distribution.platinum).toBe(1); expect(dash.distribution.bronze).toBe(1);
  });
  it('ignores refunded/failed payments in totals', () => {
    service.recordPayment({ customerId: 'c1', amount: 1000, status: 'completed', timestamp: base });
    service.recordPayment({ customerId: 'c1', amount: 500, status: 'refunded', timestamp: base });
    service.recordPayment({ customerId: 'c1', amount: 300, status: 'failed', timestamp: base });
    const clv = service.getCLV('c1'); expect(clv.totalSpend).toBe(1000); expect(clv.orderCount).toBe(1);
  });
  it('caps lifespan at the configured maximum', () => {
    const now = daysFromBase(1000);
    service.recordPayment({ customerId: 'c1', amount: 100, status: 'completed', timestamp: base });
    const clv = service.getCLV('c1', now); expect(clv.lifespanMonths).toBeLessThanOrEqual(36);
  });
});
