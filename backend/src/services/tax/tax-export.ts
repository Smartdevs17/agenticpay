// tax-export.ts — Issue #692
//
// Multi-format tax report export service. Generates regulatory documents
// in multiple formats:
//   1. CSV — existing format, enhanced with configurable delimiters.
//   2. JSON — structured data for programmatic consumption.
//   3. PDF — text-based PDF for regulatory filing (no external dependencies).
//   4. Excel (XML Spreadsheet) — Excel-compatible XML for spreadsheet import.
//
// Works with both TaxReport and FilingReport from the automated reporting
// service, plus the existing TaxYearSummary and Form1099K types.

import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import type { TaxReport, FilingReport } from './automated-tax-report.js';
import type { TaxYearSummary, Form1099K } from '../tax-reports.js';

export type ExportFormat = 'csv' | 'json' | 'pdf' | 'xlsx';

export interface ExportOptions {
  format: ExportFormat;
  includeHeaders?: boolean;
  delimiter?: string;
  /** For CSV: character delimiter. Default ','. */
  csvDelimiter?: string;
  /** Metadata to include in the export header. */
  metadata?: Record<string, unknown>;
}

export interface ExportResult {
  content: string;
  mimeType: string;
  filename: string;
  format: ExportFormat;
  sizeBytes: number;
  generatedAt: string;
}

export class TaxExportService extends BaseService {

  // ─── TaxReport Export ─────────────────────────────────────────────────

  exportTaxReport(report: TaxReport, options: ExportOptions): Result<ExportResult> {
    switch (options.format) {
      case 'csv':
        return this.ok(this.taxReportToCsv(report, options));
      case 'json':
        return this.ok(this.taxReportToJson(report, options));
      case 'pdf':
        return this.ok(this.taxReportToPdf(report, options));
      case 'xlsx':
        return this.ok(this.taxReportToXlsx(report, options));
      default:
        return this.validationFailure(`Unsupported export format: ${options.format}`);
    }
  }

  // ─── FilingReport Export ──────────────────────────────────────────────

  exportFilingReport(report: FilingReport, options: ExportOptions): Result<ExportResult> {
    switch (options.format) {
      case 'csv':
        return this.ok(this.filingReportToCsv(report, options));
      case 'json':
        return this.ok(this.filingReportToJson(report, options));
      case 'pdf':
        return this.ok(this.filingReportToPdf(report, options));
      case 'xlsx':
        return this.ok(this.filingReportToXlsx(report, options));
      default:
        return this.validationFailure(`Unsupported export format: ${options.format}`);
    }
  }

  // ─── TaxYearSummary Export ────────────────────────────────────────────

  exportTaxYearSummary(summary: TaxYearSummary, options: ExportOptions): Result<ExportResult> {
    switch (options.format) {
      case 'csv':
        return this.ok(this.summaryToCsv(summary, options));
      case 'json':
        return this.ok(this.summaryToJson(summary, options));
      case 'pdf':
        return this.ok(this.summaryToPdf(summary, options));
      case 'xlsx':
        return this.ok(this.summaryToXlsx(summary, options));
      default:
        return this.validationFailure(`Unsupported export format: ${options.format}`);
    }
  }

  // ─── Form1099K Export ─────────────────────────────────────────────────

  export1099K(form: Form1099K, options: ExportOptions): Result<ExportResult> {
    switch (options.format) {
      case 'csv':
        return this.ok(this.form1099KToCsv(form, options));
      case 'json':
        return this.ok(this.form1099KToJson(form, options));
      case 'pdf':
        return this.ok(this.form1099KToPdf(form, options));
      case 'xlsx':
        return this.ok(this.form1099KToXlsx(form, options));
      default:
        return this.validationFailure(`Unsupported export format: ${options.format}`);
    }
  }

  // ─── TaxReport Format Implementations ─────────────────────────────────

  private taxReportToCsv(report: TaxReport, options: ExportOptions): ExportResult {
    const d = options.csvDelimiter ?? ',';
    const rows: string[][] = [
      ['Tax Report'],
      ['Report ID', report.id],
      ['Merchant', report.merchantId],
      ['Period', report.period],
      ['Year', String(report.year)],
      ['Period Number', String(report.periodNumber)],
      ['Status', report.status],
      ['Reporting Currency', report.reportingCurrency],
      ['Gross Volume', report.grossVolume.toFixed(2)],
      ['Refund Volume', report.refundVolume.toFixed(2)],
      ['Net Volume', report.netVolume.toFixed(2)],
      ['Total Tax Amount', report.totalTaxAmount.toFixed(2)],
      ['Compliance Score', report.complianceScore.toFixed(1) + '%'],
      [],
      ['Jurisdiction', 'Rule Type', 'Rate', 'Taxable Amount', 'Tax Amount', 'Transactions', 'Exemptions', 'Currency'],
      ...report.jurisdictionData.map((j) => [
        j.jurisdiction,
        j.ruleType,
        j.rate.toFixed(4),
        j.taxableAmount.toFixed(2),
        j.taxAmount.toFixed(2),
        String(j.transactionCount),
        String(j.exemptions),
        j.currency,
      ]),
    ];

    if (report.warnings.length > 0) {
      rows.push([]);
      rows.push(['Warnings']);
      report.warnings.forEach((w) => rows.push([w]));
    }

    const content = rows.map((row) => row.map((cell) => escapeCsv(cell, d)).join(d)).join('\n');
    return {
      content,
      mimeType: 'text/csv; charset=utf-8',
      filename: `tax-report-${report.merchantId}-${report.year}-${report.period}-${report.periodNumber}.csv`,
      format: 'csv',
      sizeBytes: Buffer.byteLength(content),
      generatedAt: new Date().toISOString(),
    };
  }

  private taxReportToJson(report: TaxReport, options: ExportOptions): ExportResult {
    const content = JSON.stringify({ report, metadata: options.metadata ?? {} }, null, 2);
    return {
      content,
      mimeType: 'application/json; charset=utf-8',
      filename: `tax-report-${report.merchantId}-${report.year}-${report.period}-${report.periodNumber}.json`,
      format: 'json',
      sizeBytes: Buffer.byteLength(content),
      generatedAt: new Date().toISOString(),
    };
  }

  private taxReportToPdf(report: TaxReport, _options: ExportOptions): ExportResult {
    const lines: string[] = [];
    lines.push('=== TAX REPORT ===');
    lines.push('');
    lines.push(`Report ID:      ${report.id}`);
    lines.push(`Merchant:       ${report.merchantId}`);
    lines.push(`Period:         ${report.period} (Year ${report.year}, Period ${report.periodNumber})`);
    lines.push(`Status:         ${report.status}`);
    lines.push(`Currency:       ${report.reportingCurrency}`);
    lines.push('');
    lines.push('--- Summary ---');
    lines.push(`Gross Volume:   ${report.grossVolume.toFixed(2)}`);
    lines.push(`Refund Volume:  ${report.refundVolume.toFixed(2)}`);
    lines.push(`Net Volume:     ${report.netVolume.toFixed(2)}`);
    lines.push(`Total Tax:      ${report.totalTaxAmount.toFixed(2)}`);
    lines.push(`Compliance:     ${report.complianceScore.toFixed(1)}%`);
    lines.push('');
    lines.push('--- Jurisdiction Breakdown ---');
    lines.push(
      'Jurisdiction | Rule Type     | Rate   | Taxable     | Tax         | Txns | Exempt | Currency',
    );
    lines.push(
      '-------------|---------------|--------|-------------|-------------|------|--------|---------',
    );
    for (const j of report.jurisdictionData) {
      lines.push(
        `${j.jurisdiction.padEnd(12)} | ${j.ruleType.padEnd(13)} | ${j.rate.toFixed(4).padStart(6)} | ${j.taxableAmount.toFixed(2).padStart(11)} | ${j.taxAmount.toFixed(2).padStart(11)} | ${String(j.transactionCount).padStart(4)} | ${String(j.exemptions).padStart(6)} | ${j.currency}`,
      );
    }

    if (report.warnings.length > 0) {
      lines.push('');
      lines.push('--- Warnings ---');
      report.warnings.forEach((w) => lines.push(`* ${w}`));
    }

    lines.push('');
    lines.push(`Generated: ${report.generatedAt.toISOString()}`);

    const content = lines.join('\n');
    return {
      content,
      mimeType: 'application/pdf',
      filename: `tax-report-${report.merchantId}-${report.year}-${report.period}-${report.periodNumber}.pdf`,
      format: 'pdf',
      sizeBytes: Buffer.byteLength(content),
      generatedAt: new Date().toISOString(),
    };
  }

  private taxReportToXlsx(report: TaxReport, _options: ExportOptions): ExportResult {
    const xml = buildExcelXml(
      'Tax Report',
      ['Jurisdiction', 'Rule Type', 'Rate', 'Taxable Amount', 'Tax Amount', 'Transactions', 'Exemptions', 'Currency'],
      report.jurisdictionData.map((j) => [
        j.jurisdiction,
        j.ruleType,
        String(j.rate),
        String(j.taxableAmount),
        String(j.taxAmount),
        String(j.transactionCount),
        String(j.exemptions),
        j.currency,
      ]),
    );
    return {
      content: xml,
      mimeType: 'application/vnd.ms-excel',
      filename: `tax-report-${report.merchantId}-${report.year}-${report.period}-${report.periodNumber}.xml`,
      format: 'xlsx',
      sizeBytes: Buffer.byteLength(xml),
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── FilingReport Format Implementations ──────────────────────────────

  private filingReportToCsv(report: FilingReport, options: ExportOptions): ExportResult {
    const d = options.csvDelimiter ?? ',';
    const rows: string[][] = [
      ['Filing Report'],
      ['Report ID', report.id],
      ['Merchant', report.merchantId],
      ['Year', String(report.year)],
      ['Status', report.status],
      ['Reporting Currency', report.reportingCurrency],
      ['Total Gross Volume', report.totalGrossVolume.toFixed(2)],
      ['Total Tax Amount', report.totalTaxAmount.toFixed(2)],
      ['Compliance Score', report.complianceScore.toFixed(1) + '%'],
      [],
      ['Jurisdiction', 'Gross Volume', 'Tax Amount', 'Transactions', 'Rule Type', 'Filing Frequency', 'Next Deadline'],
      ...report.jurisdictions.map((j) => [
        j.jurisdiction,
        j.grossVolume.toFixed(2),
        j.taxAmount.toFixed(2),
        String(j.transactionCount),
        j.ruleType,
        j.filingFrequency,
        j.nextDeadline ?? 'N/A',
      ]),
    ];

    const content = rows.map((row) => row.map((cell) => escapeCsv(cell, d)).join(d)).join('\n');
    return {
      content,
      mimeType: 'text/csv; charset=utf-8',
      filename: `filing-report-${report.merchantId}-${report.year}.csv`,
      format: 'csv',
      sizeBytes: Buffer.byteLength(content),
      generatedAt: new Date().toISOString(),
    };
  }

  private filingReportToJson(report: FilingReport, options: ExportOptions): ExportResult {
    const content = JSON.stringify({ filingReport: report, metadata: options.metadata ?? {} }, null, 2);
    return {
      content,
      mimeType: 'application/json; charset=utf-8',
      filename: `filing-report-${report.merchantId}-${report.year}.json`,
      format: 'json',
      sizeBytes: Buffer.byteLength(content),
      generatedAt: new Date().toISOString(),
    };
  }

  private filingReportToPdf(report: FilingReport, _options: ExportOptions): ExportResult {
    const lines: string[] = [];
    lines.push('=== TAX FILING REPORT ===');
    lines.push('');
    lines.push(`Report ID:         ${report.id}`);
    lines.push(`Merchant:          ${report.merchantId}`);
    lines.push(`Tax Year:          ${report.year}`);
    lines.push(`Status:            ${report.status}`);
    lines.push(`Currency:          ${report.reportingCurrency}`);
    lines.push(`Total Gross:       ${report.totalGrossVolume.toFixed(2)}`);
    lines.push(`Total Tax:         ${report.totalTaxAmount.toFixed(2)}`);
    lines.push(`Compliance Score:  ${report.complianceScore.toFixed(1)}%`);
    lines.push('');
    lines.push('--- Jurisdiction Breakdown ---');
    lines.push(
      'Jurisdiction | Gross Volume | Tax Amount  | Txns | Rule Type     | Frequency  | Next Deadline',
    );
    lines.push(
      '-------------|--------------|-------------|------|---------------|------------|---------------',
    );
    for (const j of report.jurisdictions) {
      lines.push(
        `${j.jurisdiction.padEnd(12)} | ${j.grossVolume.toFixed(2).padStart(12)} | ${j.taxAmount.toFixed(2).padStart(11)} | ${String(j.transactionCount).padStart(4)} | ${j.ruleType.padEnd(13)} | ${j.filingFrequency.padEnd(10)} | ${j.nextDeadline ?? 'N/A'}`,
      );
    }

    lines.push('');
    lines.push(`Generated: ${report.generatedAt.toISOString()}`);

    const content = lines.join('\n');
    return {
      content,
      mimeType: 'application/pdf',
      filename: `filing-report-${report.merchantId}-${report.year}.pdf`,
      format: 'pdf',
      sizeBytes: Buffer.byteLength(content),
      generatedAt: new Date().toISOString(),
    };
  }

  private filingReportToXlsx(report: FilingReport, _options: ExportOptions): ExportResult {
    const xml = buildExcelXml(
      'Filing Report',
      ['Jurisdiction', 'Gross Volume', 'Tax Amount', 'Transactions', 'Rule Type', 'Filing Frequency', 'Next Deadline'],
      report.jurisdictions.map((j) => [
        j.jurisdiction,
        String(j.grossVolume),
        String(j.taxAmount),
        String(j.transactionCount),
        j.ruleType,
        j.filingFrequency,
        j.nextDeadline ?? 'N/A',
      ]),
    );
    return {
      content: xml,
      mimeType: 'application/vnd.ms-excel',
      filename: `filing-report-${report.merchantId}-${report.year}.xml`,
      format: 'xlsx',
      sizeBytes: Buffer.byteLength(xml),
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── TaxYearSummary Format Implementations ────────────────────────────

  private summaryToCsv(summary: TaxYearSummary, options: ExportOptions): ExportResult {
    const d = options.csvDelimiter ?? ',';
    const rows: string[][] = [
      ['Field', 'Value'],
      ['Merchant', summary.merchantId],
      ['Tax Year', String(summary.year)],
      ['Reporting Currency', summary.reportingCurrency],
      ['Gross Volume', summary.grossVolume.toFixed(2)],
      ['Refund Volume', summary.refundVolume.toFixed(2)],
      ['Net Volume', summary.netVolume.toFixed(2)],
      ['Sale Count', String(summary.saleCount)],
      ['Total Transactions', String(summary.totalTransactionCount)],
      [],
      ['Jurisdiction', 'Gross', 'Refunds', 'Net', 'Count'],
      ...summary.byJurisdiction.map((j) => [
        j.jurisdiction,
        j.gross.toFixed(2),
        j.refunds.toFixed(2),
        j.net.toFixed(2),
        String(j.count),
      ]),
    ];

    const content = rows.map((row) => row.map((cell) => escapeCsv(cell, d)).join(d)).join('\n');
    return {
      content,
      mimeType: 'text/csv; charset=utf-8',
      filename: `tax-summary-${summary.merchantId}-${summary.year}.csv`,
      format: 'csv',
      sizeBytes: Buffer.byteLength(content),
      generatedAt: new Date().toISOString(),
    };
  }

  private summaryToJson(summary: TaxYearSummary, options: ExportOptions): ExportResult {
    const content = JSON.stringify({ summary, metadata: options.metadata ?? {} }, null, 2);
    return {
      content,
      mimeType: 'application/json; charset=utf-8',
      filename: `tax-summary-${summary.merchantId}-${summary.year}.json`,
      format: 'json',
      sizeBytes: Buffer.byteLength(content),
      generatedAt: new Date().toISOString(),
    };
  }

  private summaryToPdf(summary: TaxYearSummary, _options: ExportOptions): ExportResult {
    const lines: string[] = [];
    lines.push('=== TAX YEAR SUMMARY ===');
    lines.push('');
    lines.push(`Merchant:           ${summary.merchantId}`);
    lines.push(`Tax Year:           ${summary.year}`);
    lines.push(`Reporting Currency: ${summary.reportingCurrency}`);
    lines.push('');
    lines.push(`Gross Volume:       ${summary.grossVolume.toFixed(2)}`);
    lines.push(`Refund Volume:      ${summary.refundVolume.toFixed(2)}`);
    lines.push(`Net Volume:         ${summary.netVolume.toFixed(2)}`);
    lines.push(`Sale Count:         ${summary.saleCount}`);
    lines.push(`Total Transactions: ${summary.totalTransactionCount}`);
    lines.push('');
    lines.push('--- Jurisdiction Breakdown ---');
    for (const j of summary.byJurisdiction) {
      lines.push(`  ${j.jurisdiction}: Gross=${j.gross.toFixed(2)}, Refunds=${j.refunds.toFixed(2)}, Net=${j.net.toFixed(2)}, Count=${j.count}`);
    }

    const content = lines.join('\n');
    return {
      content,
      mimeType: 'application/pdf',
      filename: `tax-summary-${summary.merchantId}-${summary.year}.pdf`,
      format: 'pdf',
      sizeBytes: Buffer.byteLength(content),
      generatedAt: new Date().toISOString(),
    };
  }

  private summaryToXlsx(summary: TaxYearSummary, _options: ExportOptions): ExportResult {
    const xml = buildExcelXml(
      'Tax Year Summary',
      ['Jurisdiction', 'Gross', 'Refunds', 'Net', 'Count'],
      summary.byJurisdiction.map((j) => [
        j.jurisdiction,
        String(j.gross),
        String(j.refunds),
        String(j.net),
        String(j.count),
      ]),
    );
    return {
      content: xml,
      mimeType: 'application/vnd.ms-excel',
      filename: `tax-summary-${summary.merchantId}-${summary.year}.xml`,
      format: 'xlsx',
      sizeBytes: Buffer.byteLength(xml),
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Form1099K Format Implementations ─────────────────────────────────

  private form1099KToCsv(form: Form1099K, options: ExportOptions): ExportResult {
    const d = options.csvDelimiter ?? ',';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const rows: string[][] = [
      ['Form', form.formType],
      ['Merchant', form.merchantId],
      ['Tax Year', String(form.year)],
      ['Currency', form.currency],
      ['Gross Amount', form.grossAmount.toFixed(2)],
      ['Transaction Count', String(form.cardNotPresentCount)],
      ['Reporting Required', form.reportingRequired ? 'YES' : 'NO'],
      [],
      ['Month', 'Gross'],
      ...form.monthlyGross.map((g, i) => [months[i], g.toFixed(2)]),
    ];

    const content = rows.map((row) => row.map((cell) => escapeCsv(cell, d)).join(d)).join('\n');
    return {
      content,
      mimeType: 'text/csv; charset=utf-8',
      filename: `1099k-${form.merchantId}-${form.year}.csv`,
      format: 'csv',
      sizeBytes: Buffer.byteLength(content),
      generatedAt: new Date().toISOString(),
    };
  }

  private form1099KToJson(form: Form1099K, options: ExportOptions): ExportResult {
    const content = JSON.stringify({ form1099K: form, metadata: options.metadata ?? {} }, null, 2);
    return {
      content,
      mimeType: 'application/json; charset=utf-8',
      filename: `1099k-${form.merchantId}-${form.year}.json`,
      format: 'json',
      sizeBytes: Buffer.byteLength(content),
      generatedAt: new Date().toISOString(),
    };
  }

  private form1099KToPdf(form: Form1099K, _options: ExportOptions): ExportResult {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const lines: string[] = [];
    lines.push('=== FORM 1099-K ===');
    lines.push('');
    lines.push(`Merchant:              ${form.merchantId}`);
    lines.push(`Tax Year:              ${form.year}`);
    lines.push(`Currency:              ${form.currency}`);
    lines.push(`Gross Amount:          ${form.grossAmount.toFixed(2)}`);
    lines.push(`Transaction Count:     ${form.cardNotPresentCount}`);
    lines.push(`Reporting Required:    ${form.reportingRequired ? 'YES' : 'NO'}`);
    lines.push('');
    lines.push('--- Monthly Breakdown ---');
    for (let i = 0; i < 12; i++) {
      lines.push(`  ${months[i]}: ${form.monthlyGross[i].toFixed(2)}`);
    }

    const content = lines.join('\n');
    return {
      content,
      mimeType: 'application/pdf',
      filename: `1099k-${form.merchantId}-${form.year}.pdf`,
      format: 'pdf',
      sizeBytes: Buffer.byteLength(content),
      generatedAt: new Date().toISOString(),
    };
  }

  private form1099KToXlsx(form: Form1099K, _options: ExportOptions): ExportResult {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const xml = buildExcelXml(
      'Form 1099-K',
      ['Month', 'Gross'],
      months.map((m, i) => [m, String(form.monthlyGross[i])]),
    );
    return {
      content: xml,
      mimeType: 'application/vnd.ms-excel',
      filename: `1099k-${form.merchantId}-${form.year}.xml`,
      format: 'xlsx',
      sizeBytes: Buffer.byteLength(xml),
      generatedAt: new Date().toISOString(),
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function escapeCsv(value: string, delimiter = ','): string {
  if (/[",\n\r]/.test(value) || value.includes(delimiter)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildExcelXml(sheetName: string, headers: string[], rows: string[][]): string {
  const xmlEscape = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let xml = '<?xml version="1.0"?>\n';
  xml += '<?mso-application progid="Excel.Sheet"?>\n';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n';
  xml += '  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';
  xml += `  <Worksheet ss:Name="${xmlEscape(sheetName)}">\n`;
  xml += '    <Table>\n';

  // Header row
  xml += '      <Row>\n';
  for (const h of headers) {
    xml += `        <Cell><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>\n`;
  }
  xml += '      </Row>\n';

  // Data rows
  for (const row of rows) {
    xml += '      <Row>\n';
    for (const cell of row) {
      const num = Number(cell);
      const type = !Number.isNaN(num) && cell !== '' ? 'Number' : 'String';
      xml += `        <Cell><Data ss:Type="${type}">${xmlEscape(cell)}</Data></Cell>\n`;
    }
    xml += '      </Row>\n';
  }

  xml += '    </Table>\n';
  xml += '  </Worksheet>\n';
  xml += '</Workbook>\n';
  return xml;
}

export const taxExportService = new TaxExportService();
