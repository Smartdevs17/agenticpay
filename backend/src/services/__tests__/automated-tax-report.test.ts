import { beforeEach, describe, expect, it } from 'vitest';
import { TaxRuleEngine } from '../tax/tax-engine.js';
import { TaxReportService } from '../tax-reports.js';
import { AutomatedTaxReportService } from '../tax/automated-tax-report.js';
import type { TaxableTransaction } from '../tax-reports.js';

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

describe('AutomatedTaxReportService — Issues #690, #691', () => {
  let engine: TaxRuleEngine;
  let reportService: TaxReportService;
  let service: AutomatedTaxReportService;

  beforeEach(() => {
    engine = new TaxRuleEngine();
    engine.resetForTests();
    reportService = new TaxReportService();
    service = new AutomatedTaxReportService(engine, reportService);
    service.resetForTests();
  });

  describe('generateReport', () => {
    it('generates a monthly report with jurisdiction aggregation', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'US Sales Tax',
        ruleType: 'sales_tax',
        rate: 0.08,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordMany([
        tx({ amount: 1000, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-06-01T10:00:00Z') }),
        tx({ amount: 500, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-06-15T10:00:00Z') }),
        tx({ amount: 100, jurisdiction: 'US', type: 'refund', timestamp: new Date('2025-06-20T10:00:00Z') }),
      ]);

      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.period).toBe('monthly');
      expect(result.value.year).toBe(2025);
      expect(result.value.periodNumber).toBe(6);
      expect(result.value.status).toBe('draft');
      expect(result.value.grossVolume).toBe(1500);
      expect(result.value.refundVolume).toBe(100);
      expect(result.value.netVolume).toBe(1400);
      expect(result.value.totalTaxAmount).toBe(112); // 1400 * 0.08
      expect(result.value.jurisdictionData).toHaveLength(1);
      expect(result.value.jurisdictionData[0].jurisdiction).toBe('US');
      expect(result.value.jurisdictionData[0].ruleType).toBe('sales_tax');
      expect(result.value.jurisdictionData[0].rate).toBe(0.08);
      expect(result.value.complianceScore).toBe(100);
    });

    it('aggregates transactions across multiple jurisdictions', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'US Sales Tax',
        ruleType: 'sales_tax',
        rate: 0.08,
        effectiveFrom: new Date('2020-01-01'),
      });
      await engine.createRule({
        jurisdiction: 'GB',
        name: 'UK VAT',
        ruleType: 'vat',
        rate: 0.2,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordMany([
        tx({ amount: 1000, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-06-01T10:00:00Z') }),
        tx({ amount: 2000, jurisdiction: 'GB', type: 'sale', timestamp: new Date('2025-06-10T10:00:00Z') }),
      ]);

      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.grossVolume).toBe(3000);
      expect(result.value.jurisdictionData).toHaveLength(2);

      const us = result.value.jurisdictionData.find((j) => j.jurisdiction === 'US');
      const gb = result.value.jurisdictionData.find((j) => j.jurisdiction === 'GB');
      expect(us?.taxAmount).toBe(80); // 1000 * 0.08
      expect(gb?.taxAmount).toBe(400); // 2000 * 0.20
      expect(result.value.totalTaxAmount).toBe(480);
    });

    it('sets tax to zero for exempt jurisdictions', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'US Sales Tax',
        ruleType: 'sales_tax',
        rate: 0.08,
        effectiveFrom: new Date('2020-01-01'),
      });
      await engine.createExemption({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        reason: 'Non-profit exemption',
        validFrom: new Date('2020-01-01'),
      });

      reportService.recordTransaction(
        tx({ amount: 1000, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-06-01T10:00:00Z') }),
      );

      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.totalTaxAmount).toBe(0);
      expect(result.value.warnings.some((w) => w.includes('exemption'))).toBe(true);
    });

    it('warns when no active rule exists for a jurisdiction', async () => {
      reportService.recordTransaction(
        tx({ amount: 500, jurisdiction: 'ZZ', type: 'sale', timestamp: new Date('2025-06-01T10:00:00Z') }),
      );

      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.warnings.some((w) => w.includes('No active tax rule'))).toBe(true);
      expect(result.value.complianceScore).toBe(0);
    });

    it('rejects missing tenantId', async () => {
      const result = await service.generateReport({
        tenantId: '',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });
      expect(result.ok).toBe(false);
    });

    it('rejects missing merchantId', async () => {
      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: '',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });
      expect(result.ok).toBe(false);
    });

    it('rejects invalid year', async () => {
      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 1999,
        periodNumber: 6,
      });
      expect(result.ok).toBe(false);
    });

    it('rejects invalid periodNumber for monthly', async () => {
      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 13,
      });
      expect(result.ok).toBe(false);
    });

    it('rejects invalid periodNumber for quarterly', async () => {
      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'quarterly',
        year: 2025,
        periodNumber: 5,
      });
      expect(result.ok).toBe(false);
    });

    it('generates quarterly report correctly', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'US Sales Tax',
        ruleType: 'sales_tax',
        rate: 0.10,
        effectiveFrom: new Date('2020-01-01'),
      });

      // Q2: April, May, June
      reportService.recordMany([
        tx({ amount: 1000, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-04-10T10:00:00Z') }),
        tx({ amount: 2000, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-05-10T10:00:00Z') }),
        tx({ amount: 3000, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-06-10T10:00:00Z') }),
      ]);

      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'quarterly',
        year: 2025,
        periodNumber: 2,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.grossVolume).toBe(6000);
      expect(result.value.totalTaxAmount).toBe(600); // 6000 * 0.10
    });

    it('generates annual report correctly', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'US Sales Tax',
        ruleType: 'sales_tax',
        rate: 0.05,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordMany([
        tx({ amount: 10000, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-01-15T10:00:00Z') }),
        tx({ amount: 10000, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-07-15T10:00:00Z') }),
      ]);

      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'annual',
        year: 2025,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.grossVolume).toBe(20000);
      expect(result.value.totalTaxAmount).toBe(1000);
      expect(result.value.periodNumber).toBe(1);
    });

    it('infers consolidated report type for mixed rule types', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'US Sales Tax',
        ruleType: 'sales_tax',
        rate: 0.08,
        effectiveFrom: new Date('2020-01-01'),
      });
      await engine.createRule({
        jurisdiction: 'GB',
        name: 'UK VAT',
        ruleType: 'vat',
        rate: 0.2,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordMany([
        tx({ amount: 1000, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-06-01T10:00:00Z') }),
        tx({ amount: 1000, jurisdiction: 'GB', type: 'sale', timestamp: new Date('2025-06-01T10:00:00Z') }),
      ]);

      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.reportType).toBe('consolidated');
    });

    it('infers single report type when all jurisdictions share the same rule type', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'US Sales Tax',
        ruleType: 'sales_tax',
        rate: 0.08,
        effectiveFrom: new Date('2020-01-01'),
      });
      await engine.createRule({
        jurisdiction: 'CA',
        name: 'CA Sales Tax',
        ruleType: 'sales_tax',
        rate: 0.05,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordMany([
        tx({ amount: 1000, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-06-01T10:00:00Z') }),
        tx({ amount: 500, jurisdiction: 'CA', type: 'sale', timestamp: new Date('2025-06-01T10:00:00Z') }),
      ]);

      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.reportType).toBe('sales_tax');
    });
  });

  describe('generateFilingReport', () => {
    it('generates a filing report with jurisdiction summaries', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'US Sales Tax',
        ruleType: 'sales_tax',
        rate: 0.08,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordTransaction(
        tx({ amount: 5000, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-06-15T10:00:00Z') }),
      );

      const result = await service.generateFilingReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        year: 2025,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.year).toBe(2025);
      expect(result.value.status).toBe('draft');
      expect(result.value.jurisdictions).toHaveLength(1);
      expect(result.value.jurisdictions[0].jurisdiction).toBe('US');
      expect(result.value.jurisdictions[0].ruleType).toBe('sales_tax');
      expect(result.value.jurisdictions[0].filingFrequency).toBe('quarterly');
      expect(result.value.jurisdictions[0].nextDeadline).not.toBeNull();
      expect(result.value.totalGrossVolume).toBe(5000);
      expect(result.value.totalTaxAmount).toBe(400);
      expect(result.value.reportIds).toHaveLength(1);
    });

    it('returns jurisdiction-aware filing frequencies', async () => {
      await engine.createRule({
        jurisdiction: 'DE',
        name: 'German VAT',
        ruleType: 'vat',
        rate: 0.19,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordTransaction(
        tx({ amount: 1000, jurisdiction: 'DE', type: 'sale', timestamp: new Date('2025-06-15T10:00:00Z') }),
      );

      const result = await service.generateFilingReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        year: 2025,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.jurisdictions[0].filingFrequency).toBe('monthly');
    });

    it('rejects missing tenantId', async () => {
      const result = await service.generateFilingReport({
        tenantId: '',
        merchantId: 'm_1',
        year: 2025,
      });
      expect(result.ok).toBe(false);
    });

    it('rejects invalid year', async () => {
      const result = await service.generateFilingReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        year: 1999,
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('report lifecycle', () => {
    it('finalizes a draft report', async () => {
      const genResult = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });
      expect(genResult.ok).toBe(true);
      if (!genResult.ok) return;

      const finalized = await service.finalizeReport(genResult.value.id);
      expect(finalized.ok).toBe(true);
      if (!finalized.ok) return;
      expect(finalized.value.status).toBe('finalized');
      expect(finalized.value.finalizedAt).not.toBeNull();
    });

    it('rejects finalizing a non-draft report', async () => {
      const genResult = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });
      if (!genResult.ok) return;

      await service.finalizeReport(genResult.value.id);
      const result = await service.finalizeReport(genResult.value.id);
      expect(result.ok).toBe(false);
    });

    it('archives a finalized report', async () => {
      const genResult = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });
      if (!genResult.ok) return;

      await service.finalizeReport(genResult.value.id);
      const archived = await service.archiveReport(genResult.value.id);
      expect(archived.ok).toBe(true);
      if (!archived.ok) return;
      expect(archived.value.status).toBe('archived');
    });

    it('rejects archiving a non-finalized report', async () => {
      const genResult = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });
      if (!genResult.ok) return;

      const result = await service.archiveReport(genResult.value.id);
      expect(result.ok).toBe(false);
    });

    it('returns not found for unknown report', async () => {
      const result = await service.finalizeReport('does-not-exist');
      expect(result.ok).toBe(false);
    });
  });

  describe('listReports', () => {
    it('lists reports with pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await service.generateReport({
          tenantId: 't_1',
          merchantId: `m_${i}`,
          period: 'monthly',
          year: 2025,
          periodNumber: 6,
        });
      }

      const page1 = await service.listReports({ tenantId: 't_1', limit: 2, offset: 0 });
      expect(page1.ok).toBe(true);
      if (!page1.ok) return;
      expect(page1.value.reports).toHaveLength(2);
      expect(page1.value.total).toBe(5);

      const page2 = await service.listReports({ tenantId: 't_1', limit: 2, offset: 2 });
      expect(page2.ok).toBe(true);
      if (!page2.ok) return;
      expect(page2.value.reports).toHaveLength(2);
    });

    it('filters by merchantId', async () => {
      await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });
      await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_2',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });

      const result = await service.listReports({ tenantId: 't_1', merchantId: 'm_1' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.total).toBe(1);
      expect(result.value.reports[0].merchantId).toBe('m_1');
    });

    it('filters by status', async () => {
      const genResult = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });
      if (genResult.ok) {
        await service.finalizeReport(genResult.value.id);
      }

      await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_2',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });

      const finalized = await service.listReports({ tenantId: 't_1', status: 'finalized' });
      expect(finalized.ok).toBe(true);
      if (!finalized.ok) return;
      expect(finalized.value.total).toBe(1);
      expect(finalized.value.reports[0].status).toBe('finalized');

      const drafts = await service.listReports({ tenantId: 't_1', status: 'draft' });
      expect(drafts.ok).toBe(true);
      if (!drafts.ok) return;
      expect(drafts.value.total).toBe(1);
    });

    it('sorts by creation date descending', async () => {
      await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 5,
      });
      await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });

      const result = await service.listReports({ tenantId: 't_1' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.reports[0].periodNumber).toBe(6);
      expect(result.value.reports[1].periodNumber).toBe(5);
    });
  });

  describe('generateScheduledReports', () => {
    it('batch generates reports for multiple merchants', async () => {
      const result = await service.generateScheduledReports({
        tenantId: 't_1',
        merchantIds: ['m_1', 'm_2', 'm_3'],
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.generated).toBe(3);
      expect(result.value.failed).toBe(0);
      expect(result.value.reportIds).toHaveLength(3);
    });

    it('handles empty merchant list', async () => {
      const result = await service.generateScheduledReports({
        tenantId: 't_1',
        merchantIds: [],
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.generated).toBe(0);
      expect(result.value.failed).toBe(0);
    });
  });

  describe('filing deadlines', () => {
    it('returns next deadline for US jurisdiction', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'US Sales Tax',
        ruleType: 'sales_tax',
        rate: 0.08,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordTransaction(
        tx({ amount: 1000, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-06-15T10:00:00Z') }),
      );

      const result = await service.generateFilingReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        year: 2025,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const usJurisdiction = result.value.jurisdictions.find((j) => j.jurisdiction === 'US');
      expect(usJurisdiction?.nextDeadline).not.toBeNull();
    });

    it('returns next deadline for GB jurisdiction', async () => {
      await engine.createRule({
        jurisdiction: 'GB',
        name: 'UK VAT',
        ruleType: 'vat',
        rate: 0.2,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordTransaction(
        tx({ amount: 1000, jurisdiction: 'GB', type: 'sale', timestamp: new Date('2025-06-15T10:00:00Z') }),
      );

      const result = await service.generateFilingReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        year: 2025,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const gbJurisdiction = result.value.jurisdictions.find((j) => j.jurisdiction === 'GB');
      expect(gbJurisdiction?.filingFrequency).toBe('quarterly');
      expect(gbJurisdiction?.nextDeadline).not.toBeNull();
    });

    it('returns monthly frequency for DE jurisdiction', async () => {
      await engine.createRule({
        jurisdiction: 'DE',
        name: 'German VAT',
        ruleType: 'vat',
        rate: 0.19,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordTransaction(
        tx({ amount: 1000, jurisdiction: 'DE', type: 'sale', timestamp: new Date('2025-06-15T10:00:00Z') }),
      );

      const result = await service.generateFilingReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        year: 2025,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const deJurisdiction = result.value.jurisdictions.find((j) => j.jurisdiction === 'DE');
      expect(deJurisdiction?.filingFrequency).toBe('monthly');
    });

    it('returns monthly frequency for FR jurisdiction', async () => {
      await engine.createRule({
        jurisdiction: 'FR',
        name: 'French TVA',
        ruleType: 'vat',
        rate: 0.2,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordTransaction(
        tx({ amount: 1000, jurisdiction: 'FR', type: 'sale', timestamp: new Date('2025-06-15T10:00:00Z') }),
      );

      const result = await service.generateFilingReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        year: 2025,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const frJurisdiction = result.value.jurisdictions.find((j) => j.jurisdiction === 'FR');
      expect(frJurisdiction?.filingFrequency).toBe('monthly');
    });

    it('returns annual frequency for JP jurisdiction', async () => {
      await engine.createRule({
        jurisdiction: 'JP',
        name: 'Japanese Consumption Tax',
        ruleType: 'withholding',
        rate: 0.1,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordTransaction(
        tx({ amount: 1000, jurisdiction: 'JP', type: 'sale', timestamp: new Date('2025-06-15T10:00:00Z') }),
      );

      const result = await service.generateFilingReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        year: 2025,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const jpJurisdiction = result.value.jurisdictions.find((j) => j.jurisdiction === 'JP');
      expect(jpJurisdiction?.filingFrequency).toBe('annual');
    });

    it('returns monthly frequency for IN jurisdiction', async () => {
      await engine.createRule({
        jurisdiction: 'IN',
        name: 'Indian GST',
        ruleType: 'gst',
        rate: 0.18,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordTransaction(
        tx({ amount: 1000, jurisdiction: 'IN', type: 'sale', timestamp: new Date('2025-06-15T10:00:00Z') }),
      );

      const result = await service.generateFilingReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        year: 2025,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const inJurisdiction = result.value.jurisdictions.find((j) => j.jurisdiction === 'IN');
      expect(inJurisdiction?.filingFrequency).toBe('monthly');
    });
  });

  describe('report accuracy', () => {
    it('rounds monetary values to 2 decimal places', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'US Tax',
        ruleType: 'sales_tax',
        rate: 0.0725,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordTransaction(
        tx({ amount: 33.33, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-06-15T10:00:00Z') }),
      );

      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.grossVolume).toBe(33.33);
      expect(result.value.totalTaxAmount).toBe(2.42); // 33.33 * 0.0725 = 2.416425 → 2.42
    });

    it('handles zero-amount transactions', async () => {
      reportService.recordTransaction(
        tx({ amount: 0, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-06-15T10:00:00Z') }),
      );

      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.grossVolume).toBe(0);
      expect(result.value.totalTaxAmount).toBe(0);
    });

    it('correctly separates refunds from sales', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'US Tax',
        ruleType: 'sales_tax',
        rate: 0.10,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordMany([
        tx({ amount: 1000, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-06-01T10:00:00Z') }),
        tx({ amount: 200, jurisdiction: 'US', type: 'refund', timestamp: new Date('2025-06-15T10:00:00Z') }),
      ]);

      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.grossVolume).toBe(1000);
      expect(result.value.refundVolume).toBe(200);
      expect(result.value.netVolume).toBe(800);
      expect(result.value.totalTaxAmount).toBe(80); // 800 * 0.10
    });

    it('only includes transactions within the reporting period', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'US Tax',
        ruleType: 'sales_tax',
        rate: 0.10,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordMany([
        tx({ amount: 500, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-05-15T10:00:00Z') }),
        tx({ amount: 1000, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-06-15T10:00:00Z') }),
        tx({ amount: 500, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-07-15T10:00:00Z') }),
      ]);

      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.grossVolume).toBe(1000);
    });
  });
});
