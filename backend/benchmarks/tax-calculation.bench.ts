import { describe, it, expect } from 'vitest';
import { TaxRuleEngine } from '../services/tax/tax-engine.js';
import { TaxReportService } from '../services/tax-reports.js';
import { AutomatedTaxReportService } from '../services/tax/automated-tax-report.js';

// Performance benchmarks for tax calculations — Issue #690
// Run with: vitest run --reporter=verbose benchmarks/tax-calculation.bench.ts

describe('Tax Calculation Performance Benchmarks', () => {
  it('processes 1000 tax calculations in under 500ms', async () => {
    const engine = new TaxRuleEngine();

    // Create rules for multiple jurisdictions
    const jurisdictions = ['US', 'GB', 'DE', 'FR', 'CA', 'AU', 'JP', 'IN', 'BR', 'MX'];
    for (const j of jurisdictions) {
      await engine.createRule({
        jurisdiction: j,
        name: `${j} Tax`,
        ruleType: 'vat',
        rate: 0.2,
        effectiveFrom: new Date('2020-01-01'),
      });
    }

    const start = performance.now();

    const promises: Promise<any>[] = [];
    for (let i = 0; i < 1000; i++) {
      const jurisdiction = jurisdictions[i % jurisdictions.length];
      promises.push(
        engine.calculate({
          tenantId: 't_1',
          merchantId: 'm_1',
          jurisdiction,
          amount: Math.random() * 10000,
          currency: 'USD',
        }),
      );
    }
    await Promise.all(promises);

    const elapsed = performance.now() - start;
    console.log(`  1000 tax calculations: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(500);
  });

  it('generates a report with 1000 transactions in under 200ms', async () => {
    const engine = new TaxRuleEngine();
    const reportService = new TaxReportService();
    const autoService = new AutomatedTaxReportService(engine, reportService);

    await engine.createRule({
      jurisdiction: 'US',
      name: 'US Tax',
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

    // Seed 1000 transactions
    const now = new Date('2025-06-15T12:00:00Z');
    for (let i = 0; i < 1000; i++) {
      reportService.recordTransaction({
        id: `tx_${i}`,
        merchantId: 'm_1',
        amount: Math.random() * 1000,
        currency: 'USD',
        jurisdiction: i % 2 === 0 ? 'US' : 'GB',
        type: 'sale',
        timestamp: now,
      });
    }

    const start = performance.now();
    const result = await autoService.generateReport({
      tenantId: 't_1',
      merchantId: 'm_1',
      period: 'monthly',
      year: 2025,
      periodNumber: 6,
    });
    const elapsed = performance.now() - start;

    console.log(`  Report generation (1000 txns): ${elapsed.toFixed(1)}ms`);
    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(200);
  });

  it('exports a report to all formats in under 100ms', async () => {
    const engine = new TaxRuleEngine();
    const reportService = new TaxReportService();
    const autoService = new AutomatedTaxReportService(engine, reportService);
    const { TaxExportService } = await import('../services/tax/tax-export.js');
    const exportService = new TaxExportService();

    await engine.createRule({
      jurisdiction: 'US',
      name: 'US Tax',
      ruleType: 'sales_tax',
      rate: 0.08,
      effectiveFrom: new Date('2020-01-01'),
    });

    reportService.recordTransaction({
      id: 'tx_1',
      merchantId: 'm_1',
      amount: 1000,
      currency: 'USD',
      jurisdiction: 'US',
      type: 'sale',
      timestamp: new Date('2025-06-15'),
    });

    const reportResult = await autoService.generateReport({
      tenantId: 't_1',
      merchantId: 'm_1',
      period: 'monthly',
      year: 2025,
      periodNumber: 6,
    });
    if (!reportResult.ok) throw new Error('Failed to generate report');
    const report = reportResult.value;

    const start = performance.now();
    for (const format of ['csv', 'json', 'pdf', 'xlsx'] as const) {
      const result = exportService.exportTaxReport(report, { format });
      expect(result.ok).toBe(true);
    }
    const elapsed = performance.now() - start;

    console.log(`  Export to 4 formats: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(100);
  });

  it('lists and filters 500 reports in under 50ms', async () => {
    const engine = new TaxRuleEngine();
    const reportService = new TaxReportService();
    const autoService = new AutomatedTaxReportService(engine, reportService);

    // Generate 500 reports
    for (let i = 0; i < 500; i++) {
      await autoService.generateReport({
        tenantId: 't_1',
        merchantId: `m_${i % 10}`,
        period: 'monthly',
        year: 2025,
        periodNumber: (i % 12) + 1,
      });
    }

    const start = performance.now();
    const result = await autoService.listReports({
      tenantId: 't_1',
      merchantId: 'm_1',
      year: 2025,
      limit: 50,
    });
    const elapsed = performance.now() - start;

    console.log(`  List/filter 500 reports: ${elapsed.toFixed(1)}ms`);
    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });
});
