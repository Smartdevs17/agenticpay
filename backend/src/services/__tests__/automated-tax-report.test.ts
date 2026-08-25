import { beforeEach, describe, expect, it } from 'vitest';
import { AutomatedTaxReportService } from '../tax/automated-tax-report.js';
import { TaxRuleEngine } from '../tax/tax-engine.js';
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

describe('AutomatedTaxReportService — Issues #690, #691', () => {
  let service: AutomatedTaxReportService;
  let engine: TaxRuleEngine;
  let reportService: TaxReportService;

  beforeEach(() => {
    engine = new TaxRuleEngine();
    engine.resetForTests();
    reportService = new TaxReportService();
    service = new AutomatedTaxReportService(engine, reportService);
    service.resetForTests();
  });

  describe('generateReport', () => {
    it('generates a monthly report with jurisdiction breakdown', async () => {
      // Add tax rules
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

      // Record transactions in June 2025
      reportService.recordMany([
        tx({ amount: 1000, jurisdiction: 'US', type: 'sale', timestamp: new Date('2025-06-10T12:00:00Z') }),
        tx({ amount: 500, jurisdiction: 'US', type: 'refund', timestamp: new Date('2025-06-15T12:00:00Z') }),
        tx({ amount: 2000, jurisdiction: 'GB', type: 'sale', timestamp: new Date('2025-06-20T12:00:00Z') }),
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

      const report = result.value;
      expect(report.period).toBe('monthly');
      expect(report.year).toBe(2025);
      expect(report.periodNumber).toBe(6);
      expect(report.status).toBe('draft');
      expect(report.grossVolume).toBe(3000);
      expect(report.refundVolume).toBe(500);
      expect(report.netVolume).toBe(2500);
      expect(report.jurisdictionData).toHaveLength(2);

      const usData = report.jurisdictionData.find((j) => j.jurisdiction === 'US');
      expect(usData?.taxableAmount).toBe(500); // 1000 - 500
      expect(usData?.taxAmount).toBe(40); // 500 * 0.08
      expect(usData?.ruleType).toBe('sales_tax');
      expect(usData?.rate).toBe(0.08);

      const gbData = report.jurisdictionData.find((j) => j.jurisdiction === 'GB');
      expect(gbData?.taxableAmount).toBe(2000);
      expect(gbData?.taxAmount).toBe(400); // 2000 * 0.2
      expect(gbData?.ruleType).toBe('vat');

      expect(report.totalTaxAmount).toBe(440);
    });

    it('generates a quarterly report', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'US Sales Tax',
        ruleType: 'sales_tax',
        rate: 0.05,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordMany([
        tx({ amount: 1000, timestamp: new Date('2025-01-15T12:00:00Z') }),
        tx({ amount: 2000, timestamp: new Date('2025-02-15T12:00:00Z') }),
        tx({ amount: 3000, timestamp: new Date('2025-03-15T12:00:00Z') }),
      ]);

      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'quarterly',
        year: 2025,
        periodNumber: 1,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.period).toBe('quarterly');
      expect(result.value.grossVolume).toBe(6000);
      expect(result.value.totalTaxAmount).toBe(300); // 6000 * 0.05
    });

    it('generates an annual report', async () => {
      reportService.recordTransaction(
        tx({ amount: 10000, timestamp: new Date('2025-06-15T12:00:00Z') }),
      );

      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'annual',
        year: 2025,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.period).toBe('annual');
      expect(result.value.periodNumber).toBe(1);
      expect(result.value.grossVolume).toBe(10000);
    });

    it('warns when no active tax rule exists for a jurisdiction', async () => {
      reportService.recordTransaction(
        tx({ amount: 500, jurisdiction: 'ZZ', timestamp: new Date('2025-06-15T12:00:00Z') }),
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
      expect(result.value.complianceScore).toBeLessThan(100);
    });

    it('sets tax to zero for jurisdictions with active exemptions', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'US Sales Tax',
        ruleType: 'sales_tax',
        rate: 0.1,
        effectiveFrom: new Date('2020-01-01'),
      });
      await engine.createExemption({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        reason: 'Non-profit',
        validFrom: new Date('2025-01-01'),
      });

      reportService.recordTransaction(
        tx({ amount: 1000, timestamp: new Date('2025-06-15T12:00:00Z') }),
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

    it('rejects invalid input', async () => {
      const result = await service.generateReport({
        tenantId: '',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
      });
      expect(result.ok).toBe(false);
    });

    it('rejects invalid year', async () => {
      const result = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 1999,
      });
      expect(result.ok).toBe(false);
    });

    it('computes 100% compliance score when all jurisdictions have rules', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'US Tax',
        ruleType: 'sales_tax',
        rate: 0.05,
        effectiveFrom: new Date('2020-01-01'),
      });

      reportService.recordTransaction(
        tx({ amount: 100, timestamp: new Date('2025-06-15T12:00:00Z') }),
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
      expect(result.value.complianceScore).toBe(100);
    });
  });

  describe('generateFilingReport', () => {
    it('generates a consolidated filing report across all jurisdictions', async () => {
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
        tx({ amount: 10000, jurisdiction: 'US', timestamp: new Date('2025-03-15T12:00:00Z') }),
        tx({ amount: 5000, jurisdiction: 'GB', timestamp: new Date('2025-08-15T12:00:00Z') }),
      ]);

      const result = await service.generateFilingReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        year: 2025,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const filing = result.value;
      expect(filing.year).toBe(2025);
      expect(filing.jurisdictions).toHaveLength(2);
      expect(filing.totalGrossVolume).toBe(15000);
      expect(filing.totalTaxAmount).toBe(1800); // 10000*0.08 + 5000*0.2
      expect(filing.reportIds).toHaveLength(1);
      expect(filing.jurisdictions[0].nextDeadline).toBeDefined();
    });

    it('rejects invalid input', async () => {
      const result = await service.generateFilingReport({
        tenantId: '',
        merchantId: 'm_1',
        year: 2025,
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('report lifecycle', () => {
    it('finalizes a draft report', async () => {
      reportService.recordTransaction(
        tx({ amount: 100, timestamp: new Date('2025-06-15T12:00:00Z') }),
      );

      const genResult = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });
      expect(genResult.ok).toBe(true);
      if (!genResult.ok) return;

      const finalResult = await service.finalizeReport(genResult.value.id);
      expect(finalResult.ok).toBe(true);
      if (!finalResult.ok) return;
      expect(finalResult.value.status).toBe('finalized');
      expect(finalResult.value.finalizedAt).not.toBeNull();
    });

    it('archives a finalized report', async () => {
      reportService.recordTransaction(
        tx({ amount: 100, timestamp: new Date('2025-06-15T12:00:00Z') }),
      );

      const genResult = await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });
      if (!genResult.ok) return;

      await service.finalizeReport(genResult.value.id);
      const archiveResult = await service.archiveReport(genResult.value.id);
      expect(archiveResult.ok).toBe(true);
      if (!archiveResult.ok) return;
      expect(archiveResult.value.status).toBe('archived');
    });

    it('cannot finalize a non-draft report', async () => {
      reportService.recordTransaction(
        tx({ amount: 100, timestamp: new Date('2025-06-15T12:00:00Z') }),
      );

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

    it('cannot archive a non-finalized report', async () => {
      reportService.recordTransaction(
        tx({ amount: 100, timestamp: new Date('2025-06-15T12:00:00Z') }),
      );

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

    it('returns not found for unknown report id', async () => {
      const result = await service.getReport('does-not-exist');
      expect(result.ok).toBe(false);
    });
  });

  describe('listReports', () => {
    it('lists reports with filters', async () => {
      reportService.recordMany([
        tx({ amount: 100, timestamp: new Date('2025-06-15T12:00:00Z') }),
        tx({ amount: 200, timestamp: new Date('2025-07-15T12:00:00Z') }),
      ]);

      await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 6,
      });
      await service.generateReport({
        tenantId: 't_1',
        merchantId: 'm_1',
        period: 'monthly',
        year: 2025,
        periodNumber: 7,
      });

      const all = await service.listReports({ tenantId: 't_1' });
      expect(all.ok).toBe(true);
      if (!all.ok) return;
      expect(all.value.total).toBe(2);

      const filtered = await service.listReports({ tenantId: 't_1', period: 'monthly', year: 2025 });
      expect(filtered.ok).toBe(true);
      if (!filtered.ok) return;
      expect(filtered.value.total).toBe(2);

      const wrongTenant = await service.listReports({ tenantId: 't_2' });
      expect(wrongTenant.ok).toBe(true);
      if (!wrongTenant.ok) return;
      expect(wrongTenant.value.total).toBe(0);
    });
  });

  describe('generateScheduledReports', () => {
    it('batch generates reports for multiple merchants', async () => {
      reportService.recordMany([
        tx({ amount: 100, merchantId: 'm_1', timestamp: new Date('2025-06-15T12:00:00Z') }),
        tx({ amount: 200, merchantId: 'm_2', timestamp: new Date('2025-06-15T12:00:00Z') }),
        tx({ amount: 300, merchantId: 'm_3', timestamp: new Date('2025-06-15T12:00:00Z') }),
      ]);

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
  });
});
