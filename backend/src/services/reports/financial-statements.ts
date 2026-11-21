/**
 * financial-statements.ts — Issue #940
 *
 * Automated financial statements generation: an income statement, a balance
 * sheet and a cash-flow summary derived from the payment ledger for a date
 * range. Every statement is reproducible from the ledger, is exportable to
 * CSV/PDF and is recorded as a `ReportJob` so the run can be audited.
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
  type CsvBlock,
} from './report-format.js';

export interface FinancialStatementFilters {
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  chain?: string;
  status?: string;
  currency?: string;
  /** Override the configured platform fee rate (basis points). */
  feeBps?: number;
}

export interface StatementLine {
  label: string;
  amount: number;
}

export interface StatementTransaction {
  id: string;
  txHash: string | null;
  date: string;
  chain: string;
  currency: string;
  type: string;
  amount: number;
  fee: number;
  net: number;
  status: string;
}

export interface PeriodSummary {
  period: string;
  txCount: number;
  grossVolume: number;
  netVolume: number;
  totalFees: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
}

export interface BalanceSheet {
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  /** True when assets equal liabilities plus equity. */
  balanced: boolean;
}

export interface FinancialStatement {
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  generatedAt: string;
  chain: string | null;
  currency: string | null;
  feeBps: number;
  incomeStatement: StatementLine[];
  balanceSheet: BalanceSheet;
  cashFlow: StatementLine[];
  transactions: StatementTransaction[];
  daily: PeriodSummary[];
  monthly: PeriodSummary[];
  totals: {
    txCount: number;
    grossVolume: number;
    netVolume: number;
    totalFees: number;
    completedCount: number;
    failedCount: number;
    pendingCount: number;
    refundedCount: number;
    reversedCount: number;
    refundedVolume: number;
    receivableVolume: number;
  };
  /** True when the ledger held more rows than a single report materialises. */
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
}

interface LedgerTotals {
  grossVolume: number;
  fees: number;
  refundedVolume: number;
  reversedVolume: number;
  receivableVolume: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
  refundedCount: number;
  reversedCount: number;
}

function emptyTotals(): LedgerTotals {
  return {
    grossVolume: 0,
    fees: 0,
    refundedVolume: 0,
    reversedVolume: 0,
    receivableVolume: 0,
    completedCount: 0,
    failedCount: 0,
    pendingCount: 0,
    refundedCount: 0,
    reversedCount: 0,
  };
}

/**
 * Classifies a ledger row into the buckets the statements are built from.
 *
 * - `completed` + non-refund rows are recognised revenue.
 * - `completed` + refund rows are money leaving the platform.
 * - `refunded` rows were recognised once and then reversed.
 * - `pending`/`processing` rows are receivables, not revenue.
 */
function accumulate(row: LedgerRow, feeBps: number, totals: LedgerTotals): void {
  if (row.status === 'completed') {
    if (row.type === 'refund') {
      totals.refundedVolume = roundMoney(totals.refundedVolume + row.amount);
      totals.refundedCount += 1;
      return;
    }
    totals.grossVolume = roundMoney(totals.grossVolume + row.amount);
    totals.fees = roundMoney(totals.fees + feeForAmount(row.amount, feeBps));
    totals.completedCount += 1;
    return;
  }

  if (row.status === 'refunded') {
    totals.reversedVolume = roundMoney(totals.reversedVolume + row.amount);
    totals.reversedCount += 1;
    return;
  }

  if (row.status === 'failed') {
    totals.failedCount += 1;
    return;
  }

  if (row.status === 'pending' || row.status === 'processing') {
    totals.receivableVolume = roundMoney(totals.receivableVolume + row.amount);
    totals.pendingCount += 1;
  }
}

function summarize(period: string, rows: LedgerRow[], feeBps: number): PeriodSummary {
  const totals = emptyTotals();
  for (const row of rows) accumulate(row, feeBps, totals);

  return {
    period,
    txCount: rows.length,
    grossVolume: totals.grossVolume,
    netVolume: roundMoney(totals.grossVolume - totals.fees),
    totalFees: totals.fees,
    completedCount: totals.completedCount,
    failedCount: totals.failedCount,
    pendingCount: totals.pendingCount,
  };
}

function groupBy(rows: LedgerRow[], key: (row: LedgerRow) => string): Map<string, LedgerRow[]> {
  const groups = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const bucket = key(row);
    const existing = groups.get(bucket);
    if (existing) existing.push(row);
    else groups.set(bucket, [row]);
  }
  return groups;
}

function buildIncomeStatement(totals: LedgerTotals): StatementLine[] {
  const refundsAndReversals = roundMoney(totals.refundedVolume + totals.reversedVolume);
  const netRevenue = roundMoney(totals.grossVolume - refundsAndReversals);

  return [
    { label: 'Gross revenue', amount: totals.grossVolume },
    { label: 'Refunds and reversals', amount: roundMoney(-refundsAndReversals) },
    { label: 'Net revenue', amount: netRevenue },
    { label: 'Platform fees', amount: roundMoney(-totals.fees) },
    { label: 'Net income', amount: roundMoney(netRevenue - totals.fees) },
  ];
}

function buildBalanceSheet(totals: LedgerTotals): BalanceSheet {
  const cash = roundMoney(totals.grossVolume - totals.fees - totals.refundedVolume - totals.reversedVolume);
  const totalAssets = roundMoney(cash + totals.receivableVolume);

  const refundsPayable = roundMoney(totals.refundedVolume + totals.reversedVolume);
  const totalLiabilities = refundsPayable;
  const totalEquity = roundMoney(totalAssets - totalLiabilities);

  return {
    assets: [
      { label: 'Cash and cash equivalents', amount: cash },
      { label: 'Accounts receivable', amount: totals.receivableVolume },
      { label: 'Total assets', amount: totalAssets },
    ],
    liabilities: [
      { label: 'Refunds and reversals payable', amount: refundsPayable },
      { label: 'Total liabilities', amount: totalLiabilities },
    ],
    equity: [
      { label: 'Retained earnings', amount: totalEquity },
      { label: 'Total equity', amount: totalEquity },
    ],
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanced: roundMoney(totalAssets - totalLiabilities - totalEquity) === 0,
  };
}

function buildCashFlow(totals: LedgerTotals): StatementLine[] {
  const netChange = roundMoney(
    totals.grossVolume - totals.refundedVolume - totals.reversedVolume - totals.fees,
  );

  return [
    { label: 'Cash inflows from customers', amount: totals.grossVolume },
    { label: 'Cash outflows for refunds and reversals', amount: roundMoney(-(totals.refundedVolume + totals.reversedVolume)) },
    { label: 'Platform fees collected', amount: roundMoney(-totals.fees) },
    { label: 'Net change in cash', amount: netChange },
  ];
}

function statementToCsv(statement: FinancialStatement): string {
  const transactionBlock: CsvBlock = {
    header: ['Date', 'Chain', 'Currency', 'Type', 'Amount', 'Fee', 'Net', 'Status', 'Transaction ID'],
    rows: statement.transactions.map((row) => [
      row.date,
      row.chain,
      row.currency,
      row.type,
      row.amount.toFixed(8),
      row.fee.toFixed(8),
      row.net.toFixed(8),
      row.status,
      row.txHash ?? row.id,
    ]),
  };

  const dailyBlock: CsvBlock = {
    header: ['Date', 'Transactions', 'Gross Volume', 'Fees', 'Net Volume', 'Completed', 'Failed', 'Pending'],
    rows: statement.daily.map((row) => [
      row.period,
      row.txCount,
      row.grossVolume.toFixed(8),
      row.totalFees.toFixed(8),
      row.netVolume.toFixed(8),
      row.completedCount,
      row.failedCount,
      row.pendingCount,
    ]),
  };

  const statementBlock: CsvBlock = {
    header: ['Statement', 'Line', 'Amount'],
    rows: [
      ...statement.incomeStatement.map((line) => ['Income statement', line.label, line.amount.toFixed(8)]),
      ...statement.balanceSheet.assets.map((line) => ['Balance sheet', line.label, line.amount.toFixed(8)]),
      ...statement.balanceSheet.liabilities.map((line) => ['Balance sheet', line.label, line.amount.toFixed(8)]),
      ...statement.balanceSheet.equity.map((line) => ['Balance sheet', line.label, line.amount.toFixed(8)]),
      ...statement.cashFlow.map((line) => ['Cash flow', line.label, line.amount.toFixed(8)]),
    ],
  };

  return buildCsv([statementBlock, transactionBlock, dailyBlock]);
}

function statementToPdf(statement: FinancialStatement): Buffer {
  const lines: string[] = [];
  lines.push(`Tenant: ${statement.tenantId}`);
  lines.push(`Period: ${statement.dateFrom} to ${statement.dateTo}`);
  lines.push(`Generated: ${statement.generatedAt}`);
  lines.push(`Chain: ${statement.chain ?? 'all'}`);
  lines.push(`Currency: ${statement.currency ?? 'all'}`);
  lines.push(`Platform fee: ${statement.feeBps} bps`);
  lines.push('');

  const renderSection = (title: string, section: StatementLine[]): void => {
    lines.push(title);
    lines.push('-'.repeat(60));
    for (const line of section) {
      lines.push(`${line.label.padEnd(38)} ${line.amount.toFixed(8)}`);
    }
    lines.push('');
  };

  renderSection('Income Statement', statement.incomeStatement);
  renderSection('Balance Sheet — Assets', statement.balanceSheet.assets);
  renderSection('Balance Sheet — Liabilities', statement.balanceSheet.liabilities);
  renderSection('Balance Sheet — Equity', statement.balanceSheet.equity);
  renderSection('Cash Flow', statement.cashFlow);

  lines.push('Daily Summary');
  lines.push('-'.repeat(60));
  lines.push('Date            | Txs | Gross     | Fees      | Net       | Completed | Failed | Pending');
  lines.push('-'.repeat(60));
  for (const day of statement.daily.slice(0, 50)) {
    lines.push(
      `${day.period.padEnd(15)} | ${String(day.txCount).padEnd(3)} | ${day.grossVolume.toFixed(8).padEnd(9)} | ` +
        `${day.totalFees.toFixed(8).padEnd(9)} | ${day.netVolume.toFixed(8).padEnd(9)} | ` +
        `${String(day.completedCount).padEnd(9)} | ${String(day.failedCount).padEnd(6)} | ${String(day.pendingCount)}`,
    );
  }
  if (statement.daily.length > 50) lines.push(`... and ${statement.daily.length - 50} more days`);

  return buildTextPdf('Financial Statement', lines);
}

export interface FinancialStatementResult {
  statement: FinancialStatement;
  csv: string;
  pdf: Buffer;
}

export class FinancialStatementService {
  /**
   * Generates the three statements for a date range straight from the ledger.
   */
  async generateStatement(filters: FinancialStatementFilters): Promise<FinancialStatementResult> {
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

    const rows: LedgerRow[] = payments.map((payment) => ({
      id: payment.id,
      txHash: payment.txHash,
      createdAt: payment.createdAt,
      network: payment.network,
      currency: payment.currency,
      status: payment.status,
      type: payment.type,
      amount: toAmount(payment.amount),
    }));

    const totals = emptyTotals();
    for (const row of rows) accumulate(row, feeBps, totals);

    const dailyGroups = groupBy(rows, (row) => dayKey(row.createdAt));
    const monthlyGroups = groupBy(rows, (row) => monthKey(row.createdAt));

    const daily = [...dailyGroups.entries()]
      .map(([key, items]) => summarize(key, items, feeBps))
      .sort((a, b) => a.period.localeCompare(b.period));
    const monthly = [...monthlyGroups.entries()]
      .map(([key, items]) => summarize(key, items, feeBps))
      .sort((a, b) => a.period.localeCompare(b.period));

    const transactions: StatementTransaction[] = rows.map((row) => {
      const fee = row.status === 'completed' && row.type !== 'refund' ? feeForAmount(row.amount, feeBps) : 0;
      return {
        id: row.id,
        txHash: row.txHash,
        date: dayKey(row.createdAt),
        chain: row.network,
        currency: row.currency,
        type: row.type,
        amount: row.amount,
        fee,
        net: roundMoney(row.amount - fee),
        status: row.status,
      };
    });

    const statement: FinancialStatement = {
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      tenantId,
      generatedAt: new Date().toISOString(),
      chain: filters.chain ?? null,
      currency: filters.currency ?? null,
      feeBps,
      incomeStatement: buildIncomeStatement(totals),
      balanceSheet: buildBalanceSheet(totals),
      cashFlow: buildCashFlow(totals),
      transactions,
      daily,
      monthly,
      totals: {
        txCount: rows.length,
        grossVolume: totals.grossVolume,
        netVolume: roundMoney(totals.grossVolume - totals.fees),
        totalFees: totals.fees,
        completedCount: totals.completedCount,
        failedCount: totals.failedCount,
        pendingCount: totals.pendingCount,
        refundedCount: totals.refundedCount,
        reversedCount: totals.reversedCount,
        refundedVolume: roundMoney(totals.refundedVolume + totals.reversedVolume),
        receivableVolume: totals.receivableVolume,
      },
      truncated: rows.length >= MAX_REPORT_ROWS,
    };

    return { statement, csv: statementToCsv(statement), pdf: statementToPdf(statement) };
  }

  /**
   * Runs a statement generation as an audited job.
   *
   * The job row is written before generation so a failed run is visible in
   * the job list instead of disappearing.
   */
  async generateStatementJob(
    filters: FinancialStatementFilters,
    userId?: string,
  ): Promise<FinancialStatementResult & { jobId: string }> {
    const period = parseReportPeriod(filters.dateFrom, filters.dateTo);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    const job = await prisma.reportJob.create({
      data: {
        tenantId: filters.tenantId,
        userId: userId ?? null,
        type: 'financial_statement',
        status: 'generating',
        dateFrom: period.from,
        dateTo: period.to,
        format: 'json',
        filters: {
          chain: filters.chain ?? null,
          status: filters.status ?? null,
          currency: filters.currency ?? null,
        },
        progress: 10,
        expiresAt,
      },
    });

    try {
      const result = await this.generateStatement(filters);

      await prisma.reportJob.update({
        where: { id: job.id },
        data: { status: 'completed', progress: 100, completedAt: new Date() },
      });

      await prisma.reportArchive.create({
        data: {
          reportId: job.id,
          format: 'json',
          fileUrl: `reports/financial-statement-${job.id}.json`,
          rowCount: result.statement.transactions.length,
          fileSize: result.csv.length,
        },
      });

      return { ...result, jobId: job.id };
    } catch (error) {
      await prisma.reportJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      throw error;
    }
  }

  /** Lists the statement jobs recorded for a tenant. */
  async listStatementJobs(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [jobs, total] = await Promise.all([
      prisma.reportJob.findMany({
        where: { tenantId, type: 'financial_statement', deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { archives: true },
      }),
      prisma.reportJob.count({
        where: { tenantId, type: 'financial_statement', deletedAt: null },
      }),
    ]);

    return { jobs, total, page, limit };
  }

  /** Reads a single statement job for a tenant. */
  async getStatementJob(jobId: string, tenantId: string) {
    const job = await prisma.reportJob.findFirst({
      where: { id: jobId, tenantId, deletedAt: null },
      include: { archives: true },
    });
    if (!job) throw new AppError(404, 'Statement job not found', 'NOT_FOUND');
    return job;
  }
}

export const financialStatementService = new FinancialStatementService();
