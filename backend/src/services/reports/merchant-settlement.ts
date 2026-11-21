/**
 * merchant-settlement.ts — Issue #938
 *
 * Merchant settlement reports: a per-merchant statement of what was
 * collected, what was refunded, what the platform charged and what is still
 * owed. Merchants are identified by the settlement account the payment was
 * made to, falling back to the paying user and finally to `unassigned`.
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

export interface MerchantSettlementFilters {
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  chain?: string;
  status?: string;
  currency?: string;
  /** Restrict the report to a single merchant. */
  merchantId?: string;
  /** Override the configured platform fee rate (basis points). */
  feeBps?: number;
}

export interface MerchantSettlementLine {
  merchantId: string;
  transactionCount: number;
  grossCollected: number;
  refunds: number;
  reversals: number;
  fees: number;
  netSettlement: number;
  inFlight: number;
  failedAmount: number;
  lastActivityAt: string | null;
}

export interface MerchantSettlementPeriod {
  period: string;
  merchantId: string;
  transactionCount: number;
  grossCollected: number;
  fees: number;
  netSettlement: number;
}

export interface MerchantSettlementReport {
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  generatedAt: string;
  feeBps: number;
  currency: string | null;
  merchants: MerchantSettlementLine[];
  daily: MerchantSettlementPeriod[];
  monthly: MerchantSettlementPeriod[];
  totals: {
    merchantCount: number;
    transactionCount: number;
    grossCollected: number;
    refunds: number;
    reversals: number;
    fees: number;
    netSettlement: number;
    inFlight: number;
    failedAmount: number;
  };
  truncated: boolean;
}

interface LedgerRow {
  createdAt: Date;
  network: string;
  currency: string;
  status: string;
  type: string;
  amount: number;
  merchantId: string;
}

function merchantKey(row: { toAddress: string | null; userId: string | null }): string {
  return row.toAddress ?? row.userId ?? 'unassigned';
}

interface SettlementAccumulator {
  transactionCount: number;
  grossCollected: number;
  refunds: number;
  reversals: number;
  fees: number;
  netSettlement: number;
  inFlight: number;
  failedAmount: number;
  lastActivityAt: Date | null;
}

function emptyAccumulator(): SettlementAccumulator {
  return {
    transactionCount: 0,
    grossCollected: 0,
    refunds: 0,
    reversals: 0,
    fees: 0,
    netSettlement: 0,
    inFlight: 0,
    failedAmount: 0,
    lastActivityAt: null,
  };
}

function accumulateRow(row: LedgerRow, feeBps: number, accumulator: SettlementAccumulator): void {
  accumulator.transactionCount += 1;
  if (!accumulator.lastActivityAt || row.createdAt > accumulator.lastActivityAt) {
    accumulator.lastActivityAt = row.createdAt;
  }

  if (row.status === 'completed') {
    if (row.type === 'refund') {
      accumulator.refunds = roundMoney(accumulator.refunds + row.amount);
      return;
    }
    const fee = feeForAmount(row.amount, feeBps);
    accumulator.grossCollected = roundMoney(accumulator.grossCollected + row.amount);
    accumulator.fees = roundMoney(accumulator.fees + fee);
    accumulator.netSettlement = roundMoney(accumulator.netSettlement + row.amount - fee);
    return;
  }

  if (row.status === 'refunded') {
    accumulator.reversals = roundMoney(accumulator.reversals + row.amount);
    return;
  }

  if (row.status === 'failed') {
    accumulator.failedAmount = roundMoney(accumulator.failedAmount + row.amount);
    return;
  }

  if (row.status === 'pending' || row.status === 'processing') {
    accumulator.inFlight = roundMoney(accumulator.inFlight + row.amount);
  }
}

function toLine(merchantId: string, accumulator: SettlementAccumulator): MerchantSettlementLine {
  return {
    merchantId,
    transactionCount: accumulator.transactionCount,
    grossCollected: accumulator.grossCollected,
    refunds: accumulator.refunds,
    reversals: accumulator.reversals,
    fees: accumulator.fees,
    netSettlement: accumulator.netSettlement,
    inFlight: accumulator.inFlight,
    failedAmount: accumulator.failedAmount,
    lastActivityAt: accumulator.lastActivityAt ? accumulator.lastActivityAt.toISOString() : null,
  };
}

function buildPeriods(
  rows: LedgerRow[],
  feeBps: number,
  periodOf: (row: LedgerRow) => string,
): MerchantSettlementPeriod[] {
  const groups = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const bucket = `${periodOf(row)}::${row.merchantId}`;
    const existing = groups.get(bucket);
    if (existing) existing.push(row);
    else groups.set(bucket, [row]);
  }

  const periods: MerchantSettlementPeriod[] = [];
  for (const [, items] of groups) {
    const accumulator = emptyAccumulator();
    for (const row of items) accumulateRow(row, feeBps, accumulator);

    periods.push({
      period: periodOf(items[0]),
      merchantId: items[0].merchantId,
      transactionCount: accumulator.transactionCount,
      grossCollected: accumulator.grossCollected,
      fees: accumulator.fees,
      netSettlement: accumulator.netSettlement,
    });
  }

  return periods.sort((a, b) => a.period.localeCompare(b.period) || a.merchantId.localeCompare(b.merchantId));
}

function reportToCsv(report: MerchantSettlementReport): string {
  const merchantBlock: CsvBlock = {
    header: [
      'Merchant',
      'Transactions',
      'Gross Collected',
      'Refunds',
      'Reversals',
      'Fees',
      'Net Settlement',
      'In Flight',
      'Failed Amount',
      'Last Activity',
    ],
    rows: report.merchants.map((merchant) => [
      merchant.merchantId,
      merchant.transactionCount,
      merchant.grossCollected.toFixed(8),
      merchant.refunds.toFixed(8),
      merchant.reversals.toFixed(8),
      merchant.fees.toFixed(8),
      merchant.netSettlement.toFixed(8),
      merchant.inFlight.toFixed(8),
      merchant.failedAmount.toFixed(8),
      merchant.lastActivityAt ?? '',
    ]),
  };

  const totalsBlock: CsvBlock = {
    header: ['Metric', 'Value'],
    rows: [
      ['Merchants', report.totals.merchantCount],
      ['Transactions', report.totals.transactionCount],
      ['Gross collected', report.totals.grossCollected.toFixed(8)],
      ['Refunds', report.totals.refunds.toFixed(8)],
      ['Reversals', report.totals.reversals.toFixed(8)],
      ['Fees', report.totals.fees.toFixed(8)],
      ['Net settlement', report.totals.netSettlement.toFixed(8)],
      ['In flight', report.totals.inFlight.toFixed(8)],
      ['Failed amount', report.totals.failedAmount.toFixed(8)],
    ],
  };

  return buildCsv([totalsBlock, merchantBlock]);
}

function reportToPdf(report: MerchantSettlementReport): Buffer {
  const lines: string[] = [];
  lines.push(`Tenant: ${report.tenantId}`);
  lines.push(`Period: ${report.dateFrom} to ${report.dateTo}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Platform fee: ${report.feeBps} bps`);
  lines.push('');
  lines.push('Totals');
  lines.push('-'.repeat(60));
  lines.push(`Merchants: ${report.totals.merchantCount}`);
  lines.push(`Transactions: ${report.totals.transactionCount}`);
  lines.push(`Gross collected: ${report.totals.grossCollected.toFixed(8)}`);
  lines.push(`Refunds: ${report.totals.refunds.toFixed(8)}`);
  lines.push(`Reversals: ${report.totals.reversals.toFixed(8)}`);
  lines.push(`Fees: ${report.totals.fees.toFixed(8)}`);
  lines.push(`Net settlement: ${report.totals.netSettlement.toFixed(8)}`);
  lines.push(`In flight: ${report.totals.inFlight.toFixed(8)}`);
  lines.push(`Failed amount: ${report.totals.failedAmount.toFixed(8)}`);
  lines.push('');
  lines.push('Merchants');
  lines.push('-'.repeat(60));
  lines.push('Merchant            | Txs | Gross     | Fees      | Net       | In Flight');
  lines.push('-'.repeat(60));

  for (const merchant of report.merchants.slice(0, 100)) {
    const name = merchant.merchantId.padEnd(18).slice(0, 18);
    lines.push(
      `${name} | ${String(merchant.transactionCount).padEnd(3)} | ${merchant.grossCollected.toFixed(8).padEnd(9)} | ` +
        `${merchant.fees.toFixed(8).padEnd(9)} | ${merchant.netSettlement.toFixed(8).padEnd(9)} | ${merchant.inFlight.toFixed(8)}`,
    );
  }

  if (report.merchants.length > 100) {
    lines.push(`... and ${report.merchants.length - 100} more merchants`);
  }

  return buildTextPdf('Merchant Settlement Report', lines);
}

export class MerchantSettlementService {
  async generateReport(
    filters: MerchantSettlementFilters,
  ): Promise<{ report: MerchantSettlementReport; csv: string; pdf: Buffer }> {
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
      createdAt: payment.createdAt,
      network: payment.network,
      currency: payment.currency,
      status: payment.status,
      type: payment.type,
      amount: toAmount(payment.amount),
      merchantId: merchantKey({ toAddress: payment.toAddress, userId: payment.userId }),
    }));

    const filtered = filters.merchantId
      ? rows.filter((row) => row.merchantId === filters.merchantId)
      : rows;

    const accumulators = new Map<string, SettlementAccumulator>();
    for (const row of filtered) {
      const existing = accumulators.get(row.merchantId);
      if (existing) {
        accumulateRow(row, feeBps, existing);
      } else {
        const accumulator = emptyAccumulator();
        accumulateRow(row, feeBps, accumulator);
        accumulators.set(row.merchantId, accumulator);
      }
    }

    const merchants = [...accumulators.entries()]
      .map(([id, accumulator]) => toLine(id, accumulator))
      .sort((a, b) => b.netSettlement - a.netSettlement || a.merchantId.localeCompare(b.merchantId));

    const totals = {
      merchantCount: merchants.length,
      transactionCount: roundMoney(
        merchants.reduce((sum, merchant) => sum + merchant.transactionCount, 0),
      ),
      grossCollected: roundMoney(merchants.reduce((sum, merchant) => sum + merchant.grossCollected, 0)),
      refunds: roundMoney(merchants.reduce((sum, merchant) => sum + merchant.refunds, 0)),
      reversals: roundMoney(merchants.reduce((sum, merchant) => sum + merchant.reversals, 0)),
      fees: roundMoney(merchants.reduce((sum, merchant) => sum + merchant.fees, 0)),
      netSettlement: roundMoney(merchants.reduce((sum, merchant) => sum + merchant.netSettlement, 0)),
      inFlight: roundMoney(merchants.reduce((sum, merchant) => sum + merchant.inFlight, 0)),
      failedAmount: roundMoney(merchants.reduce((sum, merchant) => sum + merchant.failedAmount, 0)),
    };

    const report: MerchantSettlementReport = {
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      tenantId,
      generatedAt: new Date().toISOString(),
      feeBps,
      currency: filters.currency ?? null,
      merchants,
      daily: buildPeriods(filtered, feeBps, (row) => dayKey(row.createdAt)),
      monthly: buildPeriods(filtered, feeBps, (row) => monthKey(row.createdAt)),
      totals,
      truncated: rows.length >= MAX_REPORT_ROWS,
    };

    return { report, csv: reportToCsv(report), pdf: reportToPdf(report) };
  }

  /**
   * Runs a settlement report as an audited job so the run can be replayed.
   */
  async generateSettlementJob(
    filters: MerchantSettlementFilters,
    userId?: string,
  ): Promise<{ report: MerchantSettlementReport; csv: string; pdf: Buffer; jobId: string }> {
    const period = parseReportPeriod(filters.dateFrom, filters.dateTo);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    const job = await prisma.reportJob.create({
      data: {
        tenantId: filters.tenantId,
        userId: userId ?? null,
        type: 'settlement',
        status: 'generating',
        dateFrom: period.from,
        dateTo: period.to,
        format: 'json',
        filters: {
          chain: filters.chain ?? null,
          status: filters.status ?? null,
          currency: filters.currency ?? null,
          merchantId: filters.merchantId ?? null,
        },
        progress: 10,
        expiresAt,
      },
    });

    try {
      const result = await this.generateReport(filters);

      await prisma.reportJob.update({
        where: { id: job.id },
        data: { status: 'completed', progress: 100, completedAt: new Date() },
      });

      await prisma.reportArchive.create({
        data: {
          reportId: job.id,
          format: 'json',
          fileUrl: `reports/merchant-settlement-${job.id}.json`,
          rowCount: result.report.merchants.length,
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
}

export const merchantSettlementService = new MerchantSettlementService();
