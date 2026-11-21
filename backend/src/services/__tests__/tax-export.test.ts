import { describe, expect, it, beforeEach } from 'vitest';
import { TaxExportService } from '../tax/tax-export.js';
import type { TaxReport, FilingReport } from '../tax/automated-tax-report.js';
import type { TaxYearSummary, Form1099K } from '../tax-reports.js';

function makeTaxReport(overrides?: Partial<TaxReport>): TaxReport {
  return {
    id: overrides?.id ?? 'rpt_1',
    tenantId: 't_1',
    merchantId: 'm_1',
    reportType: 'consolidated',
    period: 'monthly',
    year: 2025,
    periodNumber: 6,
    status: 'draft',
    reportingCurrency: 'USD',
    grossVolume: 5000,
    refundVolume: 500,
    netVolume: 4500,
    totalTaxAmount: 440,
    jurisdictionData: [
      {
        jurisdiction: 'US',
        ruleType: 'sales_tax',
        rate: 0.08,
        taxableAmount: 2500,
        taxAmount: 200,
        transactionCount: 10,
        exemptions: 0,
        currency: 'USD',
      },
      {
        jurisdiction: 'GB',
        ruleType: 'vat',
        rate: 0.2,
        taxableAmount: 1200,
        taxAmount: 240,
        transactionCount: 5,
        exemptions: 1,
        currency: 'USD',
      },
    ],
    complianceScore: 100,
    warnings: ['1 active exemption(s) in GB — tax set to zero'],
    metadata: null,
    generatedAt: new Date('2025-07-01T00:00:00Z'),
    finalizedAt: null,
    createdAt: new Date('2025-07-01T00:00:00Z'),
    updatedAt: new Date('2025-07-01T00:00:00Z'),
    ...overrides,
  };
}

function makeFilingReport(overrides?: Partial<FilingReport>): FilingReport {
  return {
    id: overrides?.id ?? 'filing_1',
    tenantId: 't_1',
    merchantId: 'm_1',
    year: 2025,
    status: 'draft',
    reportingCurrency: 'USD',
    totalGrossVolume: 5000,
    totalTaxAmount: 440,
    jurisdictions: [
      {
        jurisdiction: 'US',
        grossVolume: 2500,
        taxAmount: 200,
        transactionCount: 10,
        ruleType: 'sales_tax',
        filingFrequency: 'quarterly',
        nextDeadline: '2025-10-15T23:59:59.000Z',
      },
    ],
    reportIds: ['rpt_1'],
    complianceScore: 100,
    generatedAt: new Date('2025-07-01T00:00:00Z'),
    createdAt: new Date('2025-07-01T00:00:00Z'),
    ...overrides,
  };
}

function makeSummary(): TaxYearSummary {
  return {
    merchantId: 'm_1',
    year: 2025,
    reportingCurrency: 'USD',
    grossVolume: 10000,
    refundVolume: 1000,
    netVolume: 9000,
    saleCount: 50,
    totalTransactionCount: 55,
    byCurrency: [{ currency: 'USD', gross: 10000, refunds: 1000, net: 9000, count: 55 }],
    byJurisdiction: [{ jurisdiction: 'US', gross: 6000, refunds: 500, net: 5500, count: 30 }],
    warnings: [],
    retention: { retentionYears: 7, retainUntil: '2032-12-31T23:59:59.000Z' },
    generatedAt: '2025-07-01T00:00:00.000Z',
  };
}

function make1099K(): Form1099K {
  return {
    formType: '1099-K',
    merchantId: 'm_1',
    year: 2025,
    currency: 'USD',
    grossAmount: 25000,
    cardNotPresentCount: 200,
    monthlyGross: [2000, 2000, 2000, 2000, 2000, 3000, 2000, 2000, 2000, 2000, 2000, 2000],
    threshold: { grossAmount: 20000, transactionCount: 200 },
    reportingRequired: true,
    retention: { retentionYears: 7, retainUntil: '2032-12-31T23:59:59.000Z' },
    generatedAt: '2025-07-01T00:00:00.000Z',
  };
}

describe('TaxExportService — Issue #692', () => {
  let service: TaxExportService;

  beforeEach(() => {
    service = new TaxExportService();
  });

  describe('exportTaxReport', () => {
    it('exports as CSV with correct headers and data', () => {
      const report = makeTaxReport();
      const result = service.exportTaxReport(report, { format: 'csv' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.mimeType).toContain('text/csv');
      expect(result.value.content).toContain('Tax Report');
      expect(result.value.content).toContain('US');
      expect(result.value.content).toContain('GB');
      expect(result.value.content).toContain('sales_tax');
      expect(result.value.content).toContain('vat');
      expect(result.value.sizeBytes).toBeGreaterThan(0);
    });

    it('exports as JSON with structured data', () => {
      const report = makeTaxReport();
      const result = service.exportTaxReport(report, { format: 'json' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.mimeType).toContain('application/json');
      const parsed = JSON.parse(result.value.content);
      expect(parsed.report.id).toBe('rpt_1');
      expect(parsed.report.jurisdictionData).toHaveLength(2);
    });

    it('exports as PDF with formatted text', () => {
      const report = makeTaxReport();
      const result = service.exportTaxReport(report, { format: 'pdf' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.mimeType).toBe('application/pdf');
      expect(result.value.content).toContain('TAX REPORT');
      expect(result.value.content).toContain('US');
      expect(result.value.content).toContain('440.00');
    });

    it('exports as XLSX (XML Spreadsheet)', () => {
      const report = makeTaxReport();
      const result = service.exportTaxReport(report, { format: 'xlsx' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.mimeType).toBe('application/vnd.ms-excel');
      expect(result.value.content).toContain('<?xml');
      expect(result.value.content).toContain('Workbook');
    });

    it('rejects unsupported format', () => {
      const report = makeTaxReport();
      const result = service.exportTaxReport(report, { format: 'doc' as any });
      expect(result.ok).toBe(false);
    });
  });

  describe('exportFilingReport', () => {
    it('exports filing report as CSV', () => {
      const filing = makeFilingReport();
      const result = service.exportFilingReport(filing, { format: 'csv' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toContain('Filing Report');
      expect(result.value.content).toContain('US');
      expect(result.value.content).toContain('quarterly');
    });

    it('exports filing report as JSON', () => {
      const filing = makeFilingReport();
      const result = service.exportFilingReport(filing, { format: 'json' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed = JSON.parse(result.value.content);
      expect(parsed.filingReport.year).toBe(2025);
    });

    it('exports filing report as PDF', () => {
      const filing = makeFilingReport();
      const result = service.exportFilingReport(filing, { format: 'pdf' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toContain('TAX FILING REPORT');
    });

    it('exports filing report as XLSX', () => {
      const filing = makeFilingReport();
      const result = service.exportFilingReport(filing, { format: 'xlsx' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toContain('<?xml');
    });
  });

  describe('exportTaxYearSummary', () => {
    it('exports summary as CSV', () => {
      const summary = makeSummary();
      const result = service.exportTaxYearSummary(summary, { format: 'csv' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toContain('Gross Volume,10000.00');
      expect(result.value.content).toContain('US');
    });

    it('exports summary as JSON', () => {
      const summary = makeSummary();
      const result = service.exportTaxYearSummary(summary, { format: 'json' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed = JSON.parse(result.value.content);
      expect(parsed.summary.year).toBe(2025);
    });

    it('exports summary as PDF', () => {
      const summary = makeSummary();
      const result = service.exportTaxYearSummary(summary, { format: 'pdf' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toContain('TAX YEAR SUMMARY');
    });

    it('exports summary as XLSX', () => {
      const summary = makeSummary();
      const result = service.exportTaxYearSummary(summary, { format: 'xlsx' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toContain('<?xml');
    });
  });

  describe('export1099K', () => {
    it('exports 1099-K as CSV with monthly breakdown', () => {
      const form = make1099K();
      const result = service.export1099K(form, { format: 'csv' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toContain('Form,1099-K');
      expect(result.value.content).toContain('Jan');
      expect(result.value.content).toContain('2000.00');
    });

    it('exports 1099-K as JSON', () => {
      const form = make1099K();
      const result = service.export1099K(form, { format: 'json' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed = JSON.parse(result.value.content);
      expect(parsed.form1099K.grossAmount).toBe(25000);
    });

    it('exports 1099-K as PDF', () => {
      const form = make1099K();
      const result = service.export1099K(form, { format: 'pdf' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toContain('FORM 1099-K');
      expect(result.value.content).toContain('YES');
    });

    it('exports 1099-K as XLSX', () => {
      const form = make1099K();
      const result = service.export1099K(form, { format: 'xlsx' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toContain('<?xml');
      expect(result.value.content).toContain('Form 1099-K');
    });
  });

  describe('filename generation', () => {
    it('generates correct filename for each format', () => {
      const report = makeTaxReport();
      const csvResult = service.exportTaxReport(report, { format: 'csv' });
      const jsonResult = service.exportTaxReport(report, { format: 'json' });
      const pdfResult = service.exportTaxReport(report, { format: 'pdf' });
      const xlsxResult = service.exportTaxReport(report, { format: 'xlsx' });

      if (csvResult.ok) expect(csvResult.value.filename).toContain('.csv');
      if (jsonResult.ok) expect(jsonResult.value.filename).toContain('.json');
      if (pdfResult.ok) expect(pdfResult.value.filename).toContain('.pdf');
      if (xlsxResult.ok) expect(xlsxResult.value.filename).toContain('.xml');
    });
  });

  describe('custom delimiter', () => {
    it('supports custom CSV delimiter', () => {
      const summary = makeSummary();
      const result = service.exportTaxYearSummary(summary, { format: 'csv', csvDelimiter: ';' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toContain(';');
    });
  });
});
