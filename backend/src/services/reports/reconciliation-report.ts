/**
 * reconciliation-report.ts — Issue #937
 *
 * Transaction reconciliation report: every payment in the window is checked
 * against the ledger rules the platform can prove (settlement reference,
 * uniqueness of the transaction hash, positive amount) and the expected
 * settlement is reconciled against what was actually collected.
 */

import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  MAX_REPORT_ROWS,
  buildCsv,
  buildTextPdf,
  dayKey,
  feeForAmount,
  monthKey,
  parseReportPeriod,
  platformFeeBps,
  roundMoney,
  toAmount,
  weekKey,
  type CsvBlock,
} from './report-format.js';

export interface ReconciliationFilters {
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  chain?: string;
  status?: string;
  currency?: string;
  /** Requested export format. The service always returns csv and pdf. */
  format?: 'json' | 'csv' | 'pdf';
  /** Override the configured platform fee rate (basis points). */
  feeBps?: number;
}

/**
 * Outcome of reconciling a single transaction.
 *
 * - `matched` — the ledger row satisfies every check.
 * - `missing_tx_hash` — a completed payment without a settlement reference.
 * - `duplicate_tx_hash` — the settlement reference was already seen.
 * - `invalid_amount` — a non-positive amount.
 * - `not_settled` — the payment has not settled yet.
 */
export type ReconciliationStatus =
  | 'matched'
  | 'missing_tx_hash'
  | 'duplicate_tx_hash'
  | 'invalid_amount'
  | 'not_settled';

export interface ReportRow {
  txId: string;
  date: string;
  chain: string;
  currency: string;
  amount: string;
  fee: string;
  net: string;
  sender: string;
  receiver: string;
  status: string;
  memo: string;
  reconciliationStatus: ReconciliationStatus;
  note: string;
}

export interface DailySummary {
  date: string;
  chain: string;
  txCount: number;
  totalAmount: string;
  totalFee: string;
  totalNet: string;
}

export interface WeeklySummary {
  week: string;
  chain: string;
  txCount: number;
  totalAmount: string;
  totalFee: string;
  totalNet: string;
}

export interface MonthlySummary {
  month: string;
  chain: string;
  txCount: number;
  totalAmount: string;
  totalFee: string;
  totalNet: string;
}

export interface ReconciliationTotals {
  txCount: number;
  matchedCount: number;
  exceptionCount: number;
  grossAmount: number;
  totalFees: number;
  netAmount: number;
  expectedSettlement: number;
  collectedAmount: number;
  outstandingAmount: number;
  byStatus: Record<ReconciliationStatus, number>;
}

export interface ReconciliationReport {
  rows: ReportRow[];
  dailySummaries: DailySummary[];
  weeklySummaries: WeeklySummary[];
  monthlySummaries: MonthlySummary[];
  totals: ReconciliationTotals;
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  generatedAt: string;
  truncated: boolean;
}

interface LedgerRow {
  id: string;
  txHash: string | null;
  createdAt: Date;
  network: string;
  currency: string;
  status: string;
  type: string;
  amount: number;
  fromAddress: string | null;
  toAddress: string | null;
  projectTitle: string | null;
}

const EMPTY_STATUS_COUNTS: Record<ReconciliationStatus, number> = {
  matched: 0,
  missing_tx_hash: 0,
  duplicate_tx_hash: 0,
  invalid_amount: 0,
  not_settled: 0,
};

function reconcileRow(row: LedgerRow, seenHashes: Set<string>): { status: ReconciliationStatus; note: string } {
  if (row.amount <= 0) {
    return { status: 'invalid_amount', note: 'Amount must be greater than zero' };
  }

  if (row.status !== 'completed' && row.status !== 'refunded') {
    return { status: 'not_settled', note: `Payment is ${row.status}` };
  }

  if (!row.txHash) {
    return { status: 'missing_tx_hash', note: 'Settled payment has no transaction hash' };
  }

  if (seenHashes.has(row.txHash)) {
    return { status: 'duplicate_tx_hash', note: `Transaction hash ${row.txHash} was already reconciled` };
  }

  seenHashes.add(row.txHash);
  return { status: 'matched', note: '' };
}

interface AggregatedPeriod {
  date: string;
  chain: string;
  txCount: number;
  totalAmount: number;
  totalFee: number;
  totalNet: number;
}

function aggregate(rows: ReportRow[], periodOf: (row: ReportRow) => string): AggregatedPeriod[] {
  const groups = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const bucket = `${periodOf(row)}::${row.chain}`;
    const existing = groups.get(bucket);
    if (existing) existing.push(row);
    else groups.set(bucket, [row]);
  }

  return [...groups.entries()]
    .map(([, items]) => ({
      date: periodOf(items[0]),
      chain: items[0].chain,
      txCount: items.length,
      totalAmount: roundMoney(items.reduce((sum, row) => sum + Number(row.amount), 0)),
      totalFee: roundMoney(items.reduce((sum, row) => sum + Number(row.fee), 0)),
      totalNet: roundMoney(items.reduce((sum, row) => sum + Number(row.net), 0)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.chain.localeCompare(b.chain));
}

function toDaily(entries: AggregatedPeriod[]): DailySummary[] {
  return entries.map((entry) => ({
    date: entry.date,
    chain: entry.chain,
    txCount: entry.txCount,
    totalAmount: entry.totalAmount.toFixed(8),
    totalFee: entry.totalFee.toFixed(8),
    totalNet: entry.totalNet.toFixed(8),
  }));
}

function toWeekly(entries: AggregatedPeriod[]): WeeklySummary[] {
  return entries.map((entry) => ({
    week: entry.date,
    chain: entry.chain,
    txCount: entry.txCount,
    totalAmount: entry.totalAmount.toFixed(8),
    totalFee: entry.totalFee.toFixed(8),
    totalNet: entry.totalNet.toFixed(8),
  }));
}

function toMonthly(entries: AggregatedPeriod[]): MonthlySummary[] {
  return entries.map((entry) => ({
    month: entry.date,
    chain: entry.chain,
    txCount: entry.txCount,
    totalAmount: entry.totalAmount.toFixed(8),
    totalFee: entry.totalFee.toFixed(8),
    totalNet: entry.totalNet.toFixed(8),
  }));
}

function reportToCsv(report: ReconciliationReport): string {
  const transactionBlock: CsvBlock = {
    header: [
      'Transaction ID',
      'Date',
      'Chain',
      'Currency',
      'Amount',
      'Fee',
      'Net',
      'Sender',
      'Receiver',
      'Status',
      'Memo',
      'Reconciliation Status',
      'Note',
    ],
    rows: report.rows.map((row) => [
      row.txId,
      row.date,
      row.chain,
      row.currency,
      row.amount,
      row.fee,
      row.net,
      row.sender,
      row.receiver,
      row.status,
      row.memo,
      row.reconciliationStatus,
      row.note,
    ]),
  };

  const summaryBlock: CsvBlock = {
    header: ['Date', 'Chain', 'Transactions', 'Total Amount', 'Total Fee', 'Total Net'],
    rows: report.dailySummaries.map((row) => [
      row.date,
      row.chain,
      row.txCount,
      row.totalAmount,
      row.totalFee,
      row.totalNet,
    ]),
  };

  const totalsBlock: CsvBlock = {
    header: ['Metric', 'Value'],
    rows: [
      ['Transactions', report.totals.txCount],
      ['Matched', report.totals.matchedCount],
      ['Exceptions', report.totals.exceptionCount],
      ['Gross amount', report.totals.grossAmount.toFixed(8)],
      ['Fees', report.totals.totalFees.toFixed(8)],
      ['Net amount', report.totals.netAmount.toFixed(8)],
      ['Expected settlement', report.totals.expectedSettlement.toFixed(8)],
      ['Collected', report.totals.collectedAmount.toFixed(8)],
      ['Outstanding', report.totals.outstandingAmount.toFixed(8)],
    ],
  };

  return buildCsv([totalsBlock, transactionBlock, summaryBlock]);
}

function reportToPdf(report: ReconciliationReport): Buffer {
  const lines: string[] = [];
  lines.push(`Tenant: ${report.tenantId}`);
  lines.push(`Period: ${report.dateFrom} to ${report.dateTo}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('Totals');
  lines.push('-'.repeat(60));
  lines.push(`Transactions: ${report.totals.txCount}`);
  lines.push(`Matched: ${report.totals.matchedCount}`);
  lines.push(`Exceptions: ${report.totals.exceptionCount}`);
  lines.push(`Gross amount: ${report.totals.grossAmount.toFixed(8)}`);
  lines.push(`Fees: ${report.totals.totalFees.toFixed(8)}`);
  lines.push(`Net amount: ${report.totals.netAmount.toFixed(8)}`);
  lines.push(`Expected settlement: ${report.totals.expectedSettlement.toFixed(8)}`);
  lines.push(`Collected: ${report.totals.collectedAmount.toFixed(8)}`);
  lines.push(`Outstanding: ${report.totals.outstandingAmount.toFixed(8)}`);
  lines.push('');
  lines.push('Transaction Details');
  lines.push('-'.repeat(60));
  lines.push('TX ID            | Date       | Chain    | Amount   | Fee      | Net      | Status            | Result');
  lines.push('-'.repeat(60));

  for (const row of report.rows.slice(0, 100)) {
    const txId = row.txId.padEnd(16).slice(0, 16);
    const date = row.date.padEnd(10).slice(0, 10);
    const chain = row.chain.padEnd(8).slice(0, 8);
    const amount = row.amount.padEnd(8).slice(0, 8);
    const fee = row.fee.padEnd(8).slice(0, 8);
    const net = row.net.padEnd(8).slice(0, 8);
    const status = row.status.padEnd(16).slice(0, 16);
    lines.push(`${txId} | ${date} | ${chain} | ${amount} | ${fee} | ${net} | ${status} | ${row.reconciliationStatus}`);
  }

  if (report.rows.length > 100) {
    lines.push(`... and ${report.rows.length - 100} more transactions`);
  }

  lines.push('');
  lines.push('Monthly Summary');
  lines.push('-'.repeat(60));
  lines.push('Month      | Chain    | Txs  | Amount     | Fee        | Net');
  lines.push('-'.repeat(60));

  for (const summary of report.monthlySummaries) {
    const month = summary.month.padEnd(10).slice(0, 10);
    const chain = summary.chain.padEnd(8).slice(0, 8);
    const txs = String(summary.txCount).padEnd(4).slice(0, 4);
    lines.push(
      `${month} | ${chain} | ${txs} | ${summary.totalAmount.padEnd(10)} | ${summary.totalFee.padEnd(10)} | ${summary.totalNet}`,
    );
  }

  return buildTextPdf('Payment Reconciliation Report', lines);
}

export class ReconciliationReportService {
  async generateReport(filters: ReconciliationFilters): Promise<{ report: ReconciliationReport; csv: string; pdf: Buffer }> {
    const { tenantId } = filters;
    if (!tenantId) {
      throw new AppError(400, 'tenantId is required', 'VALIDATION_ERROR');
    }

    const period = parseReportPeriod(filters.dateFrom, filters.dateTo);
    const feeBps = filters.feeBps ?? platformFeeBps();

    const payments = await prisma.payment.findMany({
      where: {
        tenantId,
        createdAt: { gte: period.from, lte: period.to },
        deletedAt: null,
        ...(filters.chain ? { network: filters.chain } : {}),
        ...(filters.status ? { status: filters.status as any } : {}),
        ...(filters.currency ? { currency: filters.currency } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_REPORT_ROWS,
    });

    const ledger: LedgerRow[] = payments.map((payment) => ({
      id: payment.id,
      txHash: payment.txHash,
      createdAt: payment.createdAt,
      network: payment.network,
      currency: payment.currency,
      status: payment.status,
      type: payment.type,
      amount: toAmount(payment.amount),
      fromAddress: payment.fromAddress,
      toAddress: payment.toAddress,
      projectTitle: payment.projectTitle,
    }));

    const seenHashes = new Set<string>();
    const rows: ReportRow[] = ledger.map((row) => {
      const fee = row.status === 'completed' && row.type !== 'refund' ? feeForAmount(row.amount, feeBps) : 0;
      const outcome = reconcileRow(row, seenHashes);

      return {
        txId: row.txHash || row.id,
        date: dayKey(row.createdAt),
        chain: row.network,
        currency: row.currency,
        amount: row.amount.toFixed(8),
        fee: fee.toFixed(8),
        net: roundMoney(row.amount - fee).toFixed(8),
        sender: row.fromAddress ?? '',
        receiver: row.toAddress ?? '',
        status: row.status,
        memo: row.projectTitle ?? '',
        reconciliationStatus: outcome.status,
        note: outcome.note,
      };
    });

    const byStatus = { ...EMPTY_STATUS_COUNTS };
    let grossAmount = 0;
    let totalFees = 0;
    let collectedAmount = 0;

    for (const row of rows) {
      byStatus[row.reconciliationStatus] += 1;

      const amount = Number(row.amount);
      const fee = Number(row.fee);
      if (row.status === 'completed') {
        grossAmount = roundMoney(grossAmount + amount);
        totalFees = roundMoney(totalFees + fee);
        collectedAmount = roundMoney(collectedAmount + Number(row.net));
      }
    }

    const netAmount = roundMoney(grossAmount - totalFees);
    const exceptionCount = rows.length - byStatus.matched;

    const report: ReconciliationReport = {
      rows,
      dailySummaries: toDaily(aggregate(rows, (row) => row.date)),
      weeklySummaries: toWeekly(aggregate(rows, (row) => weekKey(new Date(row.date)))),
      monthlySummaries: toMonthly(aggregate(rows, (row) => monthKey(new Date(row.date)))),
      totals: {
        txCount: rows.length,
        matchedCount: byStatus.matched,
        exceptionCount,
        grossAmount,
        totalFees,
        netAmount,
        expectedSettlement: netAmount,
        collectedAmount,
        outstandingAmount: roundMoney(netAmount - collectedAmount),
        byStatus,
      },
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      tenantId,
      generatedAt: new Date().toISOString(),
      truncated: rows.length >= MAX_REPORT_ROWS,
    };

    return { report, csv: reportToCsv(report), pdf: reportToPdf(report) };
  }

  async saveReportJob(
    tenantId: string,
    userId: string | undefined,
    dateFrom: string,
    dateTo: string,
    format: string,
    filters: Record<string, unknown>,
  ) {
    const period = parseReportPeriod(dateFrom, dateTo);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    const job = await prisma.reportJob.create({
      data: {
        tenantId,
        userId: userId ?? null,
        type: 'reconciliation',
        status: 'pending',
        dateFrom: period.from,
        dateTo: period.to,
        format,
        filters: filters as any,
        expiresAt,
      },
    });
    return job;
  }

  async updateJobStatus(jobId: string, status: string, errorMessage?: string) {
    const data: Record<string, unknown> = { status };
    if (status === 'generating') {
      data.progress = 50;
    }
    if (status === 'completed') {
      data.progress = 100;
      data.completedAt = new Date();
    }
    if (errorMessage) {
      data.errorMessage = errorMessage;
    }
    return prisma.reportJob.update({ where: { id: jobId }, data: data as any });
  }

  async createArchive(jobId: string, format: string, fileUrl: string, rowCount: number, fileSize: number) {
    return prisma.reportArchive.create({
      data: { reportId: jobId, format, fileUrl, rowCount, fileSize },
    });
  }

  async getJob(jobId: string, tenantId: string) {
    const job = await prisma.reportJob.findFirst({
      where: { id: jobId, tenantId, deletedAt: null },
      include: { archives: true },
    });
    if (!job) throw new AppError(404, 'Report job not found', 'NOT_FOUND');
    return job;
  }

  async listJobs(tenantId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const [jobs, total] = await Promise.all([
      prisma.reportJob.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { archives: true },
      }),
      prisma.reportJob.count({ where: { tenantId, deletedAt: null } }),
    ]);
    return { jobs, total, page, limit };
  }

  async deleteJob(jobId: string, tenantId: string) {
    const job = await prisma.reportJob.findFirst({
      where: { id: jobId, tenantId, deletedAt: null },
    });
    if (!job) throw new AppError(404, 'Report job not found', 'NOT_FOUND');
    return prisma.reportJob.update({
      where: { id: jobId },
      data: { deletedAt: new Date() },
    });
  }
}

export const reconciliationReportService = new ReconciliationReportService();
