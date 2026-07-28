import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';

interface ReconciliationFilters {
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  chain?: string;
  status?: string;
  format?: 'csv' | 'pdf';
}

interface ReportRow {
  txId: string;
  date: string;
  chain: string;
  amount: string;
  fee: string;
  net: string;
  sender: string;
  receiver: string;
  status: string;
  memo: string;
}

interface DailySummary {
  date: string;
  chain: string;
  txCount: number;
  totalAmount: string;
  totalFee: string;
  totalNet: string;
}

interface WeeklySummary {
  week: string;
  chain: string;
  txCount: number;
  totalAmount: string;
  totalFee: string;
  totalNet: string;
}

interface MonthlySummary {
  month: string;
  chain: string;
  txCount: number;
  totalAmount: string;
  totalFee: string;
  totalNet: string;
}

interface ReconciliationReport {
  rows: ReportRow[];
  dailySummaries: DailySummary[];
  weeklySummaries: WeeklySummary[];
  monthlySummaries: MonthlySummary[];
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
}

function escapeCsv(val: string): string {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(rows: ReportRow[], summaries: DailySummary[] | WeeklySummary[] | MonthlySummary[], summaryLabel: string): string {
  const header = ['Transaction ID,Date,Chain,Amount,Fee,Net,Sender,Receiver,Status,Memo'];
  const dataRows = rows.map(r =>
    [escapeCsv(r.txId), escapeCsv(r.date), escapeCsv(r.chain), escapeCsv(r.amount), escapeCsv(r.fee), escapeCsv(r.net), escapeCsv(r.sender), escapeCsv(r.receiver), escapeCsv(r.status), escapeCsv(r.memo)].join(',')
  );
  const summaryHeader = [`\n${summaryLabel} Summary\n${summaryLabel},Chain,Transactions,Total Amount,Total Fee,Total Net`];
  const summaryRows = summaries.map(s =>
    [escapeCsv(s.date || s.week || s.month), escapeCsv(s.chain), String(s.txCount), escapeCsv(s.totalAmount), escapeCsv(s.totalFee), escapeCsv(s.totalNet)].join(',')
  );
  return [header.join(''), ...dataRows, '', ...summaryHeader, ...summaryRows].join('\n');
}

function buildSimplePdf(report: ReconciliationReport): Buffer {
  const lines: string[] = [];
  lines.push('Payment Reconciliation Report');
  lines.push('='.repeat(60));
  lines.push(`Period: ${report.dateFrom} to ${report.dateTo}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('Transaction Details');
  lines.push('-'.repeat(60));
  lines.push('TX ID            | Date       | Chain    | Amount   | Fee      | Net      | Status');
  lines.push('-'.repeat(60));

  for (const row of report.rows.slice(0, 100)) {
    const txId = row.txId.padEnd(16).slice(0, 16);
    const date = row.date.padEnd(10).slice(0, 10);
    const chain = row.chain.padEnd(8).slice(0, 8);
    const amount = row.amount.padEnd(8).slice(0, 8);
    const fee = row.fee.padEnd(8).slice(0, 8);
    const net = row.net.padEnd(8).slice(0, 8);
    const status = row.status.padEnd(6).slice(0, 6);
    lines.push(`${txId} | ${date} | ${chain} | ${amount} | ${fee} | ${net} | ${status}`);
  }

  if (report.rows.length > 100) {
    lines.push(`... and ${report.rows.length - 100} more transactions`);
  }

  lines.push('');
  lines.push('Monthly Summary');
  lines.push('-'.repeat(60));
  lines.push('Month      | Chain    | Txs  | Amount     | Fee        | Net');
  lines.push('-'.repeat(60));

  for (const m of report.monthlySummaries) {
    const month = m.month.padEnd(10).slice(0, 10);
    const chain = m.chain.padEnd(8).slice(0, 8);
    const txs = String(m.txCount).padEnd(4).slice(0, 4);
    const totalAmount = m.totalAmount.padEnd(10).slice(0, 10);
    const totalFee = m.totalFee.padEnd(10).slice(0, 10);
    const totalNet = m.totalNet.padEnd(10).slice(0, 10);
    lines.push(`${month} | ${chain} | ${txs} | ${totalAmount} | ${totalFee} | ${totalNet}`);
  }

  const text = lines.join('\n');
  const buffer = Buffer.from(
    'PDF-1.4\n%\xFF\xFF\xFF\xFF\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n' +
    '4 0 obj\n<< /Length ' + text.length + ' >>\nstream\n' +
    text.replace(/\(/g, '\\(').replace(/\)/g, '\\)') + '\n' +
    'endstream\nendobj\n' +
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
    'xref\n0 6\n' +
    '0000000000 65535 f \n' +
    '0000000009 00000 n \n' +
    '0000000058 00000 n \n' +
    '0000000115 00000 n \n' +
    '0000000266 00000 n \n' +
    '0000000378 00000 n \n' +
    'trailer\n<< /Size 6 /Root 1 0 R >>\n' +
    'startxref\n446\n%%EOF'
  );
  return buffer;
}

export class ReconciliationReportService {
  async generateReport(filters: ReconciliationFilters): Promise<{ report: ReconciliationReport; csv: string; pdf: Buffer }> {
    const { dateFrom, dateTo, tenantId, chain, status } = filters;

    const where: any = {
      tenantId,
      createdAt: {
        gte: new Date(dateFrom),
        lte: new Date(dateTo + 'T23:59:59.999Z'),
      },
      deletedAt: null,
    };

    if (chain) where.network = chain;
    if (status) where.status = status;

    const payments = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 10000,
    });

    const rows: ReportRow[] = payments.map(p => ({
      txId: p.txHash || p.id,
      date: p.createdAt.toISOString().split('T')[0],
      chain: p.network,
      amount: p.amount.toString(),
      fee: '0',
      net: p.amount.toString(),
      sender: p.fromAddress || '',
      receiver: p.toAddress || '',
      status: p.status,
      memo: p.projectTitle || '',
    }));

    const chainGroups: Record<string, ReportRow[]> = {};
    for (const r of rows) {
      if (!chainGroups[r.chain]) chainGroups[r.chain] = [];
      chainGroups[r.chain].push(r);
    }

    const getDateKey = (d: string) => d;
    const getWeekKey = (d: string) => {
      const date = new Date(d);
      const start = new Date(date);
      start.setDate(date.getDate() - date.getDay());
      return start.toISOString().split('T')[0];
    };
    const getMonthKey = (d: string) => d.slice(0, 7);

    const aggregate = (grouped: Record<string, ReportRow[]>) => {
      const entries: { date: string; chain: string; txCount: number; totalAmount: number; totalFee: number; totalNet: number }[] = [];
      for (const [key, items] of Object.entries(grouped)) {
        entries.push({
          date: key,
          chain: items[0].chain,
          txCount: items.length,
          totalAmount: items.reduce((s, r) => s + parseFloat(r.amount || '0'), 0),
          totalFee: items.reduce((s, r) => s + parseFloat(r.fee || '0'), 0),
          totalNet: items.reduce((s, r) => s + parseFloat(r.net || '0'), 0),
        });
      }
      return entries.sort((a, b) => a.date.localeCompare(b.date));
    };

    const dailyGroups: Record<string, ReportRow[]> = {};
    const weeklyGroups: Record<string, ReportRow[]> = {};
    const monthlyGroups: Record<string, ReportRow[]> = {};

    for (const r of rows) {
      const dk = getDateKey(r.date);
      if (!dailyGroups[dk]) dailyGroups[dk] = [];
      dailyGroups[dk].push(r);

      const wk = getWeekKey(r.date);
      if (!weeklyGroups[wk]) weeklyGroups[wk] = [];
      weeklyGroups[wk].push(r);

      const mk = getMonthKey(r.date);
      if (!monthlyGroups[mk]) monthlyGroups[mk] = [];
      monthlyGroups[mk].push(r);
    }

    const formatSummary = (entries: any[], labelKey: string): any[] =>
      entries.map(e => ({
        [labelKey]: e.date,
        chain: e.chain,
        txCount: e.txCount,
        totalAmount: e.totalAmount.toFixed(8),
        totalFee: e.totalFee.toFixed(8),
        totalNet: e.totalNet.toFixed(8),
      }));

    const dailySummaries = formatSummary(aggregate(dailyGroups), 'date') as DailySummary[];
    const weeklySummaries = formatSummary(aggregate(weeklyGroups), 'week') as WeeklySummary[];
    const monthlySummaries = formatSummary(aggregate(monthlyGroups), 'month') as MonthlySummary[];

    const report: ReconciliationReport = {
      rows,
      dailySummaries,
      weeklySummaries,
      monthlySummaries,
      dateFrom,
      dateTo,
      generatedAt: new Date().toISOString(),
    };

    const csv = toCsv(rows, dailySummaries, 'Daily');
    const pdf = buildSimplePdf(report);

    return { report, csv, pdf };
  }

  async saveReportJob(
    tenantId: string,
    userId: string | undefined,
    dateFrom: string,
    dateTo: string,
    format: string,
    filters: any,
  ) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    const job = await prisma.reportJob.create({
      data: {
        tenantId,
        userId,
        type: 'reconciliation',
        status: 'pending',
        dateFrom: new Date(dateFrom),
        dateTo: new Date(dateTo),
        format,
        filters,
        expiresAt,
      },
    });
    return job;
  }

  async updateJobStatus(jobId: string, status: string, errorMessage?: string) {
    const data: any = { status };
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
    return prisma.reportJob.update({ where: { id: jobId }, data });
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
