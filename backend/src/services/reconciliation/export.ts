/**
 * Reconciliation report export in CSV and JSON formats (#1017).
 *
 * Generates scheduled reconciliation reports with totals and references
 * for finance teams.
 */
import { createObjectCsvWriter } from 'csv-writer';
import { promises as fs } from 'fs';
import path from 'path';
import { createModuleLogger } from '../middleware/logger.js';

const logger = createModuleLogger('reconciliation-export');

export interface ReconciliationEntry {
  reference: string;
  provider: string;
  externalId: string;
  amount: number;
  currency: string;
  status: string;
  expectedAmount: number;
  discrepancy: number;
  timestamp: string;
}

export interface ReconciliationReport {
  reportId: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  totals: {
    entryCount: number;
    totalAmount: number;
    totalExpected: number;
    totalDiscrepancy: number;
    byProvider: Record<string, { count: number; amount: number }>;
    byStatus: Record<string, number>;
  };
  entries: ReconciliationEntry[];
}

/**
 * Export a reconciliation report to CSV.
 */
export async function exportCsv(
  report: ReconciliationReport,
  outputPath: string
): Promise<string> {
  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: 'reference', title: 'Reference' },
      { id: 'provider', title: 'Provider' },
      { id: 'externalId', title: 'External ID' },
      { id: 'amount', title: 'Amount' },
      { id: 'currency', title: 'Currency' },
      { id: 'status', title: 'Status' },
      { id: 'expectedAmount', title: 'Expected Amount' },
      { id: 'discrepancy', title: 'Discrepancy' },
      { id: 'timestamp', title: 'Timestamp' },
    ],
  });

  await csvWriter.writeRecords(report.entries);

  // Append summary section
  const summary = [
    '',
    'SUMMARY',
    `Report ID,${report.reportId}`,
    `Generated,${report.generatedAt}`,
    `Period,${report.periodStart} to ${report.periodEnd}`,
    `Total Entries,${report.totals.entryCount}`,
    `Total Amount,${report.totals.totalAmount}`,
    `Total Expected,${report.totals.totalExpected}`,
    `Total Discrepancy,${report.totals.totalDiscrepancy}`,
    '',
    'BY PROVIDER',
    ...Object.entries(report.totals.byProvider).map(
      ([p, v]) => `${p},${v.count},${v.amount}`
    ),
    '',
    'BY STATUS',
    ...Object.entries(report.totals.byStatus).map(([s, c]) => `${s},${c}`),
  ].join('\n');

  await fs.appendFile(outputPath, summary, 'utf8');
  logger.info({ reportId: report.reportId, path: outputPath }, 'CSV report exported');
  return outputPath;
}

/**
 * Export a reconciliation report to JSON.
 */
export async function exportJson(
  report: ReconciliationReport,
  outputPath: string
): Promise<string> {
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
  logger.info({ reportId: report.reportId, path: outputPath }, 'JSON report exported');
  return outputPath;
}

/**
 * Generate and export a reconciliation report in the requested format.
 */
export async function exportReport(
  report: ReconciliationReport,
  format: 'csv' | 'json',
  outputDir: string = './exports'
): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const filename = `reconciliation-${report.reportId}.${format}`;
  const outputPath = path.join(outputDir, filename);

  if (format === 'csv') {
    return exportCsv(report, outputPath);
  }
  return exportJson(report, outputPath);
}
