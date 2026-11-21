// Multi-currency P&L service tests â€” Issue #941
import { describe, expect, it, beforeEach } from 'vitest';
import { PnLService } from '../pnl.js';

describe('PnLService â€” Issue #941', () => {
  let service: PnLService;
  beforeEach(() => { service = new PnLService('USD'); service.setFXRate('EUR', 'USD', 1.1); service.setFXRate('GBP', 'USD', 1.25); });
  it('records revenue and cost entries', () => {
    const rev = service.recordRevenue(100, 'USD', { reference: 'inv-1' });
    const cost = service.recordCost(40, 'USD', { reference: 'ref-1' });
    expect(rev.type).toBe('revenue'); expect(rev.amount).toBe(100); expect(rev.currency).toBe('USD');
    expect(cost.type).toBe('cost'); expect(service.count()).toBe(2);
  });
  it('computes per-currency P&L and base-currency totals', () => {
    service.recordRevenue(1000, 'USD'); service.recordCost(300, 'USD');
    service.recordRevenue(500, 'EUR'); service.recordCost(200, 'EUR');
    const report = service.report(); expect(report.baseCurrency).toBe('USD');
    const usd = report.lines.find((l) => l.currency === 'USD');
    expect(usd!.revenue).toBe(1000); expect(usd!.cost).toBe(300); expect(usd!.profit).toBe(700); expect(usd!.margin).toBe(0.7); expect(usd!.revenueBase).toBe(1000);
    const eur = report.lines.find((l) => l.currency === 'EUR');
    expect(eur!.revenueBase).toBe(550); expect(eur!.costBase).toBe(220); expect(eur!.profitBase).toBe(330);
    expect(report.totals.revenue).toBe(1550); expect(report.totals.cost).toBe(520); expect(report.totals.profit).toBe(1030);
    expect(report.totals.margin).toBeCloseTo(1030 / 1550);
  });
  it('margin is zero when revenue is zero', () => {
    service.recordCost(50, 'USD'); const report = service.report();
    const usd = report.lines.find((l) => l.currency === 'USD')!;
    expect(usd.revenue).toBe(0); expect(usd.margin).toBe(0); expect(report.totals.margin).toBe(0);
  });
  it('throws when converting with no FX rate', () => {
    service.recordRevenue(100, 'JPY'); expect(() => service.report()).toThrow(/No FX rate/);
  });
  it('filters report by time window', () => {
    const base = new Date('2026-01-01T00:00:00Z');
    service.recordRevenue(100, 'USD', { timestamp: new Date(base.getTime() - 10 * 24 * 60 * 60 * 1000) });
    service.recordRevenue(200, 'USD', { timestamp: base });
    expect(service.report().totals.revenue).toBe(300);
    expect(service.report({ since: base }).totals.revenue).toBe(200);
  });
  it('converts amount to base currency', () => {
    expect(service.convert(100, 'EUR', 'USD')).toBe(110); expect(service.convert(100, 'USD', 'USD')).toBe(100);
  });
  it('throws on invalid FX rate', () => { expect(() => service.setFXRate('USD', 'EUR', -1)).toThrow(); expect(() => service.setFXRate('USD', 'EUR', 0)).toThrow(); });
  it('is read-only for report methods', () => { service.recordRevenue(100, 'USD'); const before = service.count(); service.report(); expect(service.count()).toBe(before); });
});
