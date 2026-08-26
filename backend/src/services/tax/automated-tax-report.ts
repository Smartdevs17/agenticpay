// automated-tax-report.ts — Issues #690, #691
//
// Orchestrates automated tax report generation with jurisdiction-aware
// calculation. Provides:
//   1. Scheduled report generation (monthly, quarterly, annual).
//   2. Multi-jurisdiction aggregation into unified filing reports.
//   3. Report lifecycle management (draft → finalized → archived).
//   4. Integration with the tax rule engine for jurisdiction-aware amounts.
//   5. Consolidated filing preparation across all active jurisdictions.
//
// Follows the same Prisma/in-memory dual-mode pattern as tax-engine.ts.

import { randomUUID } from 'node:crypto';
import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { prisma } from '../../lib/prisma.js';
import type { TaxRuleEngine } from './tax-engine.js';
import type { TaxReportService, TaxableTransaction } from '../tax-reports.js';

export type ReportPeriod = 'monthly' | 'quarterly' | 'annual';
export type ReportStatus = 'draft' | 'finalized' | 'archived';
export type ReportType = 'summary' | 'vat' | 'sales_tax' | 'gst' | 'withholding' | 'filing' | 'consolidated';

export interface GenerateReportInput {
  tenantId: string;
  merchantId: string;
  period: ReportPeriod;
  year: number;
  /** 1-12 for monthly, 1-4 for quarterly, ignored for annual. */
  periodNumber?: number;
  jurisdictions?: string[];
  reportingCurrency?: string;
  rates?: Record<string, number>;
}

export interface JurisdictionReportData {
  jurisdiction: string;
  ruleType: string;
  rate: number;
  taxableAmount: number;
  taxAmount: number;
  transactionCount: number;
  exemptions: number;
  currency: string;
}

export interface TaxReport {
  id: string;
  tenantId: string;
  merchantId: string;
  reportType: ReportType;
  period: ReportPeriod;
  year: number;
  periodNumber: number;
  status: ReportStatus;
  reportingCurrency: string;
  grossVolume: number;
  refundVolume: number;
  netVolume: number;
  totalTaxAmount: number;
  jurisdictionData: JurisdictionReportData[];
  complianceScore: number;
  warnings: string[];
  metadata: Record<string, unknown> | null;
  generatedAt: Date;
  finalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FilingReport {
  id: string;
  tenantId: string;
  merchantId: string;
  year: number;
  status: ReportStatus;
  reportingCurrency: string;
  totalGrossVolume: number;
  totalTaxAmount: number;
  jurisdictions: FilingJurisdictionSummary[];
  reportIds: string[];
  complianceScore: number;
  generatedAt: Date;
  createdAt: Date;
}

export interface FilingJurisdictionSummary {
  jurisdiction: string;
  grossVolume: number;
  taxAmount: number;
  transactionCount: number;
  ruleType: string;
  filingFrequency: string;
  nextDeadline: string | null;
}

export interface ListReportsOptions {
  tenantId?: string;
  merchantId?: string;
  period?: ReportPeriod;
  year?: number;
  status?: ReportStatus;
  reportType?: ReportType;
  limit?: number;
  offset?: number;
}

export interface ReportListResult {
  reports: TaxReport[];
  total: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const PERIOD_MONTH_MAP: Record<ReportPeriod, (year: number, periodNumber: number) => { start: Date; end: Date }> = {
  monthly: (year, p) => ({
    start: new Date(Date.UTC(year, p - 1, 1, 0, 0, 0)),
    end: new Date(Date.UTC(year, p, 0, 23, 59, 59)),
  }),
  quarterly: (year, p) => ({
    start: new Date(Date.UTC(year, (p - 1) * 3, 1, 0, 0, 0)),
    end: new Date(Date.UTC(year, p * 3, 0, 23, 59, 59)),
  }),
  annual: (year) => ({
    start: new Date(Date.UTC(year, 0, 1, 0, 0, 0)),
    end: new Date(Date.UTC(year, 11, 31, 23, 59, 59)),
  }),
};

export class AutomatedTaxReportService extends BaseService {
  private reports: TaxReport[] = [];
  private filingReports: FilingReport[] = [];

  constructor(
    private taxEngine: TaxRuleEngine,
    private taxReportService: TaxReportService,
  ) {
    super();
  }

  private usePrisma(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  // ─── Report Generation ────────────────────────────────────────────────

  async generateReport(input: GenerateReportInput): Promise<Result<TaxReport>> {
    if (!input.tenantId) return this.validationFailure('tenantId is required');
    if (!input.merchantId) return this.validationFailure('merchantId is required');
    if (input.year < 2000 || input.year > 2100) {
      return this.validationFailure('year must be between 2000 and 2100');
    }

    const periodNumber = this.resolvePeriodNumber(input.period, input.periodNumber);
    if (periodNumber === null) {
      return this.validationFailure(this.periodNumberError(input.period));
    }

    const { start, end } = PERIOD_MONTH_MAP[input.period](input.year, periodNumber);
    const reportingCurrency = (input.reportingCurrency ?? 'USD').toUpperCase();

    // Gather transactions for the period
    const transactions = this.getTransactionsForPeriod(input.merchantId, start, end);

    // Aggregate by jurisdiction
    const jurisdictionAgg = new Map<string, {
      gross: number;
      refunds: number;
      net: number;
      count: number;
      currency: string;
    }>();

    let grossVolume = 0;
    let refundVolume = 0;

    for (const tx of transactions) {
      const jur = jurisdictionAgg.get(tx.jurisdiction) ?? {
        gross: 0,
        refunds: 0,
        net: 0,
        count: 0,
        currency: tx.currency,
      };
      jur.count += 1;
      if (tx.type === 'sale') {
        grossVolume += tx.amount;
        jur.gross += tx.amount;
      } else {
        refundVolume += tx.amount;
        jur.refunds += tx.amount;
      }
      jur.net = jur.gross - jur.refunds;
      jurisdictionAgg.set(tx.jurisdiction, jur);
    }

    // For each jurisdiction with activity, look up the applicable rule and calculate tax
    const jurisdictionData: JurisdictionReportData[] = [];
    let totalTaxAmount = 0;
    const warnings: string[] = [];

    for (const [jurisdiction, agg] of Array.from(jurisdictionAgg.entries())) {
      const rulesResult = await this.taxEngine.listRules({
        jurisdiction,
        activeOnly: true,
        at: end,
      });
      const rules = rulesResult.ok ? rulesResult.value : [];
      const rule = rules.length > 0 ? rules[0] : null;

      let taxAmount = 0;
      let rate = 0;
      let ruleType = 'unknown';

      if (rule) {
        ruleType = rule.ruleType;
        rate = rule.rate;
        taxAmount = round2(agg.net * rule.rate);
      } else {
        warnings.push(`No active tax rule for jurisdiction ${jurisdiction} during the reporting period`);
      }

      // Check for exemptions
      const exemptionsResult = await this.taxEngine.listExemptions({
        tenantId: input.tenantId,
        merchantId: input.merchantId,
        jurisdiction,
        activeOnly: true,
      });
      const activeExemptions = exemptionsResult.ok
        ? exemptionsResult.value.filter((e) => e.validFrom <= end && (e.validTo === null || e.validTo >= start))
        : [];

      if (activeExemptions.length > 0) {
        taxAmount = 0;
        warnings.push(`${activeExemptions.length} active exemption(s) in ${jurisdiction} — tax set to zero`);
      }

      totalTaxAmount += taxAmount;

      jurisdictionData.push({
        jurisdiction,
        ruleType,
        rate,
        taxableAmount: round2(agg.net),
        taxAmount,
        transactionCount: agg.count,
        exemptions: activeExemptions.length,
        currency: reportingCurrency,
      });
    }

    // Compliance score: percentage of jurisdictions with active rules
    const totalJurisdictions = jurisdictionAgg.size;
    const coveredJurisdictions = jurisdictionData.filter((j) => j.ruleType !== 'unknown').length;
    const complianceScore = totalJurisdictions === 0
      ? 100
      : round2((coveredJurisdictions / totalJurisdictions) * 100);

    const now = new Date();
    const report: TaxReport = {
      id: randomUUID(),
      tenantId: input.tenantId,
      merchantId: input.merchantId,
      reportType: this.inferReportType(jurisdictionData),
      period: input.period,
      year: input.year,
      periodNumber,
      status: 'draft',
      reportingCurrency,
      grossVolume: round2(grossVolume),
      refundVolume: round2(refundVolume),
      netVolume: round2(grossVolume - refundVolume),
      totalTaxAmount: round2(totalTaxAmount),
      jurisdictionData,
      complianceScore,
      warnings,
      metadata: null,
      generatedAt: now,
      finalizedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    if (this.usePrisma()) {
      // Persist via Prisma (store as JSON fields for jurisdiction data)
      const row = await (prisma as any).taxReport.create({
        data: {
          id: report.id,
          tenantId: report.tenantId,
          merchantId: report.merchantId,
          reportType: report.reportType,
          period: report.period,
          year: report.year,
          periodNumber: report.periodNumber,
          status: report.status,
          reportingCurrency: report.reportingCurrency,
          grossVolume: report.grossVolume,
          refundVolume: report.refundVolume,
          netVolume: report.netVolume,
          totalTaxAmount: report.totalTaxAmount,
          jurisdictionData: report.jurisdictionData,
          complianceScore: report.complianceScore,
          warnings: report.warnings,
          metadata: report.metadata,
          generatedAt: report.generatedAt,
        },
      });
      report.createdAt = row.createdAt;
      report.updatedAt = row.updatedAt;
    } else {
      this.reports.push(report);
    }

    return this.ok(report);
  }

  // ─── Filing Report ────────────────────────────────────────────────────

  async generateFilingReport(input: {
    tenantId: string;
    merchantId: string;
    year: number;
    reportingCurrency?: string;
    rates?: Record<string, number>;
  }): Promise<Result<FilingReport>> {
    if (!input.tenantId) return this.validationFailure('tenantId is required');
    if (!input.merchantId) return this.validationFailure('merchantId is required');
    if (input.year < 2000 || input.year > 2100) {
      return this.validationFailure('year must be between 2000 and 2100');
    }

    // Generate annual report first
    const annualResult = await this.generateReport({
      tenantId: input.tenantId,
      merchantId: input.merchantId,
      period: 'annual',
      year: input.year,
      reportingCurrency: input.reportingCurrency,
      rates: input.rates,
    });
    if (!annualResult.ok) {
      return this.fail(annualResult.error.message, annualResult.error.statusCode, annualResult.error.code);
    }

    const annualReport = annualResult.value;

    // Build jurisdiction summaries for filing
    const jurisdictions: FilingJurisdictionSummary[] = annualReport.jurisdictionData.map((jd) => ({
      jurisdiction: jd.jurisdiction,
      grossVolume: jd.taxableAmount,
      taxAmount: jd.taxAmount,
      transactionCount: jd.transactionCount,
      ruleType: jd.ruleType,
      filingFrequency: this.inferFilingFrequency(jd.jurisdiction),
      nextDeadline: this.getNextFilingDeadline(jd.jurisdiction, input.year),
    }));

    const now = new Date();
    const filingReport: FilingReport = {
      id: randomUUID(),
      tenantId: input.tenantId,
      merchantId: input.merchantId,
      year: input.year,
      status: 'draft',
      reportingCurrency: annualReport.reportingCurrency,
      totalGrossVolume: annualReport.grossVolume,
      totalTaxAmount: annualReport.totalTaxAmount,
      jurisdictions,
      reportIds: [annualReport.id],
      complianceScore: annualReport.complianceScore,
      generatedAt: now,
      createdAt: now,
    };

    if (this.usePrisma()) {
      const row = await (prisma as any).taxFilingReport.create({
        data: {
          id: filingReport.id,
          tenantId: filingReport.tenantId,
          merchantId: filingReport.merchantId,
          year: filingReport.year,
          status: filingReport.status,
          reportingCurrency: filingReport.reportingCurrency,
          totalGrossVolume: filingReport.totalGrossVolume,
          totalTaxAmount: filingReport.totalTaxAmount,
          jurisdictions: filingReport.jurisdictions,
          reportIds: filingReport.reportIds,
          complianceScore: filingReport.complianceScore,
          generatedAt: filingReport.generatedAt,
        },
      });
      filingReport.createdAt = row.createdAt;
    } else {
      this.filingReports.push(filingReport);
    }

    return this.ok(filingReport);
  }

  // ─── Report Lifecycle ─────────────────────────────────────────────────

  async finalizeReport(reportId: string): Promise<Result<TaxReport>> {
    const report = this.findReport(reportId);
    if (!report) return this.notFoundFailure('TaxReport', reportId);
    if (report.status !== 'draft') {
      return this.validationFailure('Only draft reports can be finalized');
    }

    report.status = 'finalized';
    report.finalizedAt = new Date();
    report.updatedAt = new Date();
    return this.ok(report);
  }

  async archiveReport(reportId: string): Promise<Result<TaxReport>> {
    const report = this.findReport(reportId);
    if (!report) return this.notFoundFailure('TaxReport', reportId);
    if (report.status !== 'finalized') {
      return this.validationFailure('Only finalized reports can be archived');
    }

    report.status = 'archived';
    report.updatedAt = new Date();
    return this.ok(report);
  }

  // ─── List / Get ───────────────────────────────────────────────────────

  async getReport(reportId: string): Promise<Result<TaxReport>> {
    const report = this.findReport(reportId);
    if (!report) return this.notFoundFailure('TaxReport', reportId);
    return this.ok(report);
  }

  async listReports(options: ListReportsOptions = {}): Promise<Result<ReportListResult>> {
    const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = options.offset ?? 0;

    let reports = [...this.reports];

    if (options.tenantId) reports = reports.filter((r) => r.tenantId === options.tenantId);
    if (options.merchantId) reports = reports.filter((r) => r.merchantId === options.merchantId);
    if (options.period) reports = reports.filter((r) => r.period === options.period);
    if (options.year) reports = reports.filter((r) => r.year === options.year);
    if (options.status) reports = reports.filter((r) => r.status === options.status);
    if (options.reportType) reports = reports.filter((r) => r.reportType === options.reportType);

    reports.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = reports.length;
    const page = reports.slice(offset, offset + limit);

    return this.ok({ reports: page, total });
  }

  async getFilingReport(filingId: string): Promise<Result<FilingReport>> {
    const filing = this.filingReports.find((f) => f.id === filingId);
    if (!filing) return this.notFoundFailure('FilingReport', filingId);
    return this.ok(filing);
  }

  // ─── Scheduled Batch Generation ───────────────────────────────────────

  async generateScheduledReports(input: {
    tenantId: string;
    merchantIds: string[];
    period: ReportPeriod;
    year: number;
    periodNumber?: number;
  }): Promise<Result<{ generated: number; failed: number; reportIds: string[] }>> {
    const reportIds: string[] = [];
    let generated = 0;
    let failed = 0;

    for (const merchantId of input.merchantIds) {
      const result = await this.generateReport({
        tenantId: input.tenantId,
        merchantId,
        period: input.period,
        year: input.year,
        periodNumber: input.periodNumber,
      });
      if (result.ok) {
        generated += 1;
        reportIds.push(result.value.id);
      } else {
        failed += 1;
      }
    }

    return this.ok({ generated, failed, reportIds });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private findReport(reportId: string): TaxReport | undefined {
    return this.reports.find((r) => r.id === reportId);
  }

  private getTransactionsForPeriod(merchantId: string, start: Date, end: Date): TaxableTransaction[] {
    // Access the taxReportService's transactions through the shared store
    // Since TaxReportService is in-memory, we filter by merchant and time range
    const allTxs = (this.taxReportService as any).transactions as TaxableTransaction[];
    return allTxs.filter(
      (tx: TaxableTransaction) =>
        tx.merchantId === merchantId &&
        tx.timestamp >= start &&
        tx.timestamp <= end,
    );
  }

  private resolvePeriodNumber(period: ReportPeriod, periodNumber?: number): number | null {
    if (period === 'annual') return 1;
    if (periodNumber !== undefined) return periodNumber;
    // Default: current month/quarter
    const now = new Date();
    if (period === 'monthly') return now.getUTCMonth() + 1;
    if (period === 'quarterly') return Math.ceil((now.getUTCMonth() + 1) / 3);
    return 1;
  }

  private periodNumberError(period: ReportPeriod): string {
    if (period === 'monthly') return 'periodNumber must be 1-12 for monthly reports';
    if (period === 'quarterly') return 'periodNumber must be 1-4 for quarterly reports';
    return 'periodNumber is not applicable for annual reports';
  }

  private inferReportType(data: JurisdictionReportData[]): ReportType {
    if (data.length === 0) return 'summary';
    const types = new Set(data.map((d) => d.ruleType));
    if (types.size === 1) {
      const single = Array.from(types)[0];
      if (single === 'vat') return 'vat';
      if (single === 'sales_tax') return 'sales_tax';
      if (single === 'gst') return 'gst';
      if (single === 'withholding') return 'withholding';
    }
    return 'consolidated';
  }

  private inferFilingFrequency(jurisdiction: string): string {
    const j = jurisdiction.toUpperCase();
    const frequencyMap: Record<string, string> = {
      US: 'quarterly',
      GB: 'quarterly',
      DE: 'monthly',
      FR: 'monthly',
      CA: 'quarterly',
      AU: 'quarterly',
      JP: 'annual',
      IN: 'monthly',
    };
    return frequencyMap[j] ?? 'quarterly';
  }

  private getNextFilingDeadline(jurisdiction: string, year: number): string | null {
    const now = new Date();
    const j = jurisdiction.toUpperCase();

    const deadlineRules: Record<string, Array<{ month: number; day: number }>> = {
      US: [
        { month: 3, day: 15 },
        { month: 6, day: 15 },
        { month: 9, day: 15 },
        { month: 0, day: 15 }, // Jan 15 of next year
      ],
      GB: [
        { month: 0, day: 7 },
        { month: 3, day: 7 },
        { month: 6, day: 7 },
        { month: 9, day: 7 },
      ],
      DE: [
        { month: 0, day: 10 },
        { month: 1, day: 10 },
        { month: 2, day: 10 },
        { month: 3, day: 10 },
        { month: 4, day: 10 },
        { month: 5, day: 10 },
        { month: 6, day: 10 },
        { month: 7, day: 10 },
        { month: 8, day: 10 },
        { month: 9, day: 10 },
        { month: 10, day: 10 },
        { month: 11, day: 10 },
      ],
      FR: [
        { month: 0, day: 24 },
        { month: 1, day: 24 },
        { month: 2, day: 24 },
        { month: 3, day: 24 },
        { month: 4, day: 24 },
        { month: 5, day: 24 },
        { month: 6, day: 24 },
        { month: 7, day: 24 },
        { month: 8, day: 24 },
        { month: 9, day: 24 },
        { month: 10, day: 24 },
        { month: 11, day: 24 },
      ],
      CA: [
        { month: 0, day: 15 },
        { month: 3, day: 15 },
        { month: 6, day: 15 },
        { month: 9, day: 15 },
      ],
      AU: [
        { month: 0, day: 28 },
        { month: 3, day: 28 },
        { month: 6, day: 28 },
        { month: 9, day: 28 },
      ],
      JP: [{ month: 2, day: 31 }], // Annual: March 31
      IN: [
        { month: 0, day: 20 },
        { month: 1, day: 20 },
        { month: 2, day: 20 },
        { month: 3, day: 20 },
        { month: 4, day: 20 },
        { month: 5, day: 20 },
        { month: 6, day: 20 },
        { month: 7, day: 20 },
        { month: 8, day: 20 },
        { month: 9, day: 20 },
        { month: 10, day: 20 },
        { month: 11, day: 20 },
      ],
    };

    const rules = deadlineRules[j];
    if (!rules) {
      // Default: end of month following quarter end
      const quarterEnd = new Date(Date.UTC(year, Math.ceil((now.getUTCMonth() + 1) / 3) * 3, 0));
      const deadline = new Date(Date.UTC(quarterEnd.getUTCFullYear(), quarterEnd.getUTCMonth() + 1, 21));
      return deadline > now ? deadline.toISOString() : null;
    }

    for (const rule of rules) {
      const deadlineYear = rule.month === 0 && j === 'US' ? year + 1 : year;
      const deadline = new Date(Date.UTC(deadlineYear, rule.month, rule.day, 23, 59, 59));
      if (deadline > now) return deadline.toISOString();
    }

    return null;
  }

  resetForTests(): void {
    this.reports = [];
    this.filingReports = [];
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
