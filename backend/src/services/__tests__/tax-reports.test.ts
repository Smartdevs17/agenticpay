import { beforeEach, describe, expect, it } from 'vitest';
import { TaxReportService, TaxableTransaction } from '../tax-reports.js';

function tx(overrides: Partial<TaxableTransaction>): TaxableTransaction {
  return {
    id: overrides.id ?? `tx_${Math.random().toString(36).slice(2)}`,
    merchantId: overrides.merchantId ?? 'm_1',
    amount: overrides.amount ?? 100,
    currency: overrides.currency ?? 'USD',
    jurisdiction: overrides.jurisdiction ?? 'US',
    type: overrides.type ?? 'sale',
    timestamp: overrides.timestamp ?? new Date('2025-06-15T12:00:00Z'),
  };
}

describe('TaxReportService', () => {
  let service: TaxReportService;

  beforeEach(() => {
    service = new TaxReportService();
  });

  describe('getYearSummary', () => {
    it('computes gross, refund and net volume for the year', () => {
      service.recordMany([
        tx({ amount: 1000, type: 'sale' }),
        tx({ amount: 500, type: 'sale' }),
        tx({ amount: 200, type: 'refund' }),
        // Different year — must be excluded.
        tx({ amount: 9999, type: 'sale', timestamp: new Date('2024-01-01T00:00:00Z') }),
      ]);

      const summary = service.getYearSummary('m_1', 2025);
      expect(summary.grossVolume).toBe(1500);
      expect(summary.refundVolume).toBe(200);
      expect(summary.netVolume).toBe(1300);
      expect(summary.saleCount).toBe(2);
      expect(summary.totalTransactionCount).toBe(3);
    });

    it('breaks down by jurisdiction', () => {
      service.recordMany([
        tx({ amount: 300, jurisdiction: 'US' }),
        tx({ amount: 700, jurisdiction: 'GB' }),
      ]);
      const summary = service.getYearSummary('m_1', 2025);
      const gb = summary.byJurisdiction.find((j) => j.jurisdiction === 'GB');
      expect(gb?.gross).toBe(700);
    });

    it('converts multi-currency totals with provided rates', () => {
      service.recordMany([
        tx({ amount: 100, currency: 'USD' }),
        tx({ amount: 100, currency: 'EUR' }),
      ]);
      const summary = service.getYearSummary('m_1', 2025, {
        reportingCurrency: 'USD',
        rates: { EUR: 1.1 },
      });
      expect(summary.grossVolume).toBe(210); // 100 + 100*1.1
      expect(summary.warnings).toHaveLength(0);
    });

    it('warns when a currency has no conversion rate', () => {
      service.recordMany([tx({ amount: 100, currency: 'JPY' })]);
      const summary = service.getYearSummary('m_1', 2025, { reportingCurrency: 'USD' });
      expect(summary.warnings.length).toBeGreaterThan(0);
    });

    it('includes a 7-year retention policy', () => {
      const summary = service.getYearSummary('m_1', 2025);
      expect(summary.retention.retentionYears).toBe(7);
      expect(summary.retention.retainUntil).toContain('2032-12-31');
    });
  });

  describe('generate1099K', () => {
    it('flags reporting required when both thresholds are met', () => {
      for (let i = 0; i < 200; i++) {
        service.recordTransaction(tx({ id: `s${i}`, amount: 150, type: 'sale' }));
      }
      const form = service.generate1099K('m_1', 2025);
      expect(form.grossAmount).toBe(30_000);
      expect(form.cardNotPresentCount).toBe(200);
      expect(form.reportingRequired).toBe(true);
      expect(form.monthlyGross[5]).toBe(30_000); // June (index 5)
    });

    it('does not require reporting below the threshold', () => {
      service.recordTransaction(tx({ amount: 100, type: 'sale' }));
      const form = service.generate1099K('m_1', 2025);
      expect(form.reportingRequired).toBe(false);
    });

    it('honours a custom threshold', () => {
      service.recordTransaction(tx({ amount: 5000, type: 'sale' }));
      const form = service.generate1099K('m_1', 2025, { grossAmount: 600 });
      expect(form.reportingRequired).toBe(true);
    });

    it('only counts US sales', () => {
      service.recordTransaction(tx({ amount: 5000, jurisdiction: 'GB', type: 'sale' }));
      const form = service.generate1099K('m_1', 2025, { grossAmount: 100 });
      expect(form.grossAmount).toBe(0);
      expect(form.reportingRequired).toBe(false);
    });
  });

  describe('generateVatReport', () => {
    it('computes VAT on the net taxable base', () => {
      service.recordMany([
        tx({ amount: 1000, jurisdiction: 'GB', type: 'sale', currency: 'GBP' }),
        tx({ amount: 200, jurisdiction: 'GB', type: 'refund', currency: 'GBP' }),
      ]);
      const report = service.generateVatReport('m_1', 2025, { jurisdiction: 'GB', rate: 0.2 });
      expect(report.taxableBase).toBe(800);
      expect(report.vatDue).toBe(160);
      expect(report.currency).toBe('GBP');
    });

    it('extracts VAT when amounts are VAT-inclusive', () => {
      service.recordTransaction(tx({ amount: 120, jurisdiction: 'GB', type: 'sale' }));
      const report = service.generateVatReport('m_1', 2025, {
        jurisdiction: 'GB',
        rate: 0.2,
        amountsIncludeVat: true,
      });
      expect(report.taxableBase).toBe(100);
      expect(report.vatDue).toBe(20);
    });

    it('rejects an out-of-range rate', () => {
      expect(() => service.generateVatReport('m_1', 2025, { jurisdiction: 'GB', rate: 1.5 })).toThrow();
    });
  });

  describe('detectNexus', () => {
    it('flags jurisdictions that exceed the amount or transaction threshold', () => {
      service.recordTransaction(tx({ amount: 150_000, jurisdiction: 'US', type: 'sale' }));
      for (let i = 0; i < 5; i++) {
        service.recordTransaction(tx({ id: `gb${i}`, amount: 10, jurisdiction: 'GB', type: 'sale' }));
      }
      const results = service.detectNexus('m_1', 2025);
      const us = results.find((r) => r.jurisdiction === 'US');
      const gb = results.find((r) => r.jurisdiction === 'GB');
      expect(us?.hasNexus).toBe(true);
      expect(gb?.hasNexus).toBe(false);
    });

    it('respects custom thresholds', () => {
      for (let i = 0; i < 3; i++) {
        service.recordTransaction(tx({ id: `t${i}`, amount: 10, jurisdiction: 'CA', type: 'sale' }));
      }
      const results = service.detectNexus('m_1', 2025, { transactions: 3 });
      expect(results.find((r) => r.jurisdiction === 'CA')?.hasNexus).toBe(true);
    });
  });

  describe('CSV export', () => {
    it('exports a summary as CSV with escaped fields', () => {
      service.recordTransaction(tx({ amount: 1000, type: 'sale' }));
      const csv = service.summaryToCsv(service.getYearSummary('m_1', 2025));
      expect(csv).toContain('Gross Volume,1000.00');
      expect(csv).toContain('Jurisdiction,Gross,Refunds,Net,Count');
    });

    it('exports a 1099-K as CSV with monthly rows', () => {
      service.recordTransaction(tx({ amount: 500, type: 'sale' }));
      const csv = service.form1099KToCsv(service.generate1099K('m_1', 2025));
      expect(csv).toContain('Form,1099-K');
      expect(csv).toContain('Jun,500.00');
    });
  });
});
