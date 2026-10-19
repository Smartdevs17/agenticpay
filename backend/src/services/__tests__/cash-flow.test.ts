// Cash flow forecasting service tests â€” Issue #944
import { describe, expect, it, beforeEach } from 'vitest';
import { CashFlowService } from '../cash-flow.js';
const base = new Date('2026-01-01T00:00:00Z');
function days(d: number): Date { return new Date(base.getTime() + d * 24 * 60 * 60 * 1000); }

describe('CashFlowService â€” Issue #944', () => {
  let service: CashFlowService;
  beforeEach(() => { service = new CashFlowService(); });
  it('records inflow and outflow and computes summary', () => {
    service.recordInflow(1000, { timestamp: base }); service.recordOutflow(300, { timestamp: days(1) }); service.recordOutflow(200, { timestamp: days(2) });
    const summary = service.summary();
    expect(summary.totalInflow).toBe(1000); expect(summary.totalOutflow).toBe(500); expect(summary.netFlow).toBe(500);
    expect(summary.currentBalance).toBe(500); expect(summary.transactionCount).toBe(3);
  });
  it('forecasts balance using average net flow per period', () => {
    for (let i = 0; i < 3; i++) { service.recordInflow(100, { timestamp: days(i) }); service.recordOutflow(40, { timestamp: days(i) }); }
    const fc = service.forecast({ horizon: 3, asOf: days(10) });
    expect(fc.startingBalance).toBe(180); expect(fc.avgNetFlowPerPeriod).toBeCloseTo(60, 1); expect(fc.horizon).toBe(3);
    expect(fc.forecast).toHaveLength(3); expect(fc.riskOfShortfall).toBe(false);
    expect(fc.forecast[2].projectedBalance).toBeCloseTo(360, 1);
  });
  it('detects shortfall risk when outflows exceed inflows', () => {
    service.recordInflow(10, { timestamp: base }); service.recordOutflow(1000, { timestamp: base });
    const fc = service.forecast({ horizon: 2, asOf: days(5) });
    expect(fc.riskOfShortfall).toBe(true); expect(fc.minBalance).toBeLessThan(0);
  });
  it('returns zero forecast with no history', () => {
    const fc = service.forecast({ horizon: 3, asOf: base });
    expect(fc.startingBalance).toBe(0); expect(fc.avgNetFlowPerPeriod).toBe(0); expect(fc.riskOfShortfall).toBe(false);
  });
  it('filters summary by currency and time window', () => {
    service.recordInflow(1000, { currency: 'USD', timestamp: base }); service.recordInflow(500, { currency: 'EUR', timestamp: days(1) }); service.recordOutflow(200, { currency: 'USD', timestamp: days(2) });
    const usd = service.summary({ currency: 'USD' }); expect(usd.totalInflow).toBe(1000); expect(usd.totalOutflow).toBe(200);
    const window = service.summary({ since: days(1), until: days(3) }); expect(window.transactionCount).toBe(2);
  });
  it('is read-only for forecast methods', () => {
    service.recordInflow(100, { timestamp: base }); const before = service.list().length;
    service.forecast({ horizon: 3, asOf: base }); expect(service.list().length).toBe(before);
  });
});
