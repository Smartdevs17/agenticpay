import { beforeEach, describe, expect, it, vi } from 'vitest';

const paymentMock = { findMany: vi.fn() };
const reportJobMock = { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() };
const reportArchiveMock = { create: vi.fn() };

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    payment: paymentMock,
    reportJob: reportJobMock,
    reportArchive: reportArchiveMock,
  },
}));

const { reconciliationReportService } = await import('../reconciliation-report.js');

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay_1',
    txHash: 'tx_1',
    amount: '100.00000000',
    currency: 'XLM',
    network: 'stellar',
    status: 'completed',
    type: 'milestone_payment',
    projectTitle: 'Milestone 1',
    projectId: null,
    milestoneId: null,
    userId: 'usr_1',
    fromAddress: 'G_FROM',
    toAddress: 'G_TO',
    metadata: null,
    createdAt: new Date('2026-01-15T00:00:00.000Z'),
    updatedAt: new Date('2026-01-15T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

const FILTERS = { tenantId: 'tenant_1', dateFrom: '2026-01-01', dateTo: '2026-01-31' };

describe('reconciliationReportService.generateReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REPORT_PLATFORM_FEE_BPS;
  });

  it('matches a settled payment that carries a transaction hash', async () => {
    paymentMock.findMany.mockResolvedValue([payment({ amount: '100' })]);

    const { report } = await reconciliationReportService.generateReport(FILTERS);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      txId: 'tx_1',
      amount: '100.00000000',
      fee: '0.00000000',
      net: '100.00000000',
      reconciliationStatus: 'matched',
    });
    expect(report.totals).toMatchObject({
      txCount: 1,
      matchedCount: 1,
      exceptionCount: 0,
      grossAmount: 100,
      expectedSettlement: 100,
      collectedAmount: 100,
      outstandingAmount: 0,
    });
  });

  it('flags a settled payment without a transaction hash', async () => {
    paymentMock.findMany.mockResolvedValue([payment({ txHash: null })]);

    const { report } = await reconciliationReportService.generateReport(FILTERS);

    expect(report.rows[0].reconciliationStatus).toBe('missing_tx_hash');
    expect(report.rows[0].note).toMatch(/no transaction hash/i);
    expect(report.totals.exceptionCount).toBe(1);
  });

  it('flags a transaction hash that was already reconciled', async () => {
    paymentMock.findMany.mockResolvedValue([
      payment({ id: 'pay_1', txHash: 'tx_1' }),
      payment({ id: 'pay_2', txHash: 'tx_1' }),
    ]);

    const { report } = await reconciliationReportService.generateReport(FILTERS);

    expect(report.rows[0].reconciliationStatus).toBe('matched');
    expect(report.rows[1].reconciliationStatus).toBe('duplicate_tx_hash');
    expect(report.totals.matchedCount).toBe(1);
    expect(report.totals.exceptionCount).toBe(1);
  });

  it('flags a non-positive amount before anything else', async () => {
    paymentMock.findMany.mockResolvedValue([payment({ amount: '0', txHash: null })]);

    const { report } = await reconciliationReportService.generateReport(FILTERS);

    expect(report.rows[0].reconciliationStatus).toBe('invalid_amount');
  });

  it('marks payments that have not settled yet', async () => {
    paymentMock.findMany.mockResolvedValue([payment({ status: 'pending', txHash: null })]);

    const { report } = await reconciliationReportService.generateReport(FILTERS);

    expect(report.rows[0].reconciliationStatus).toBe('not_settled');
    expect(report.rows[0].note).toMatch(/pending/);
  });

  it('keeps failed payments out of the collected settlement', async () => {
    paymentMock.findMany.mockResolvedValue([
      payment({ id: 'pay_1', txHash: 'tx_1', amount: '100', status: 'completed' }),
      payment({ id: 'pay_2', txHash: 'tx_2', amount: '40', status: 'failed' }),
    ]);

    const { report } = await reconciliationReportService.generateReport(FILTERS);

    expect(report.totals.grossAmount).toBe(100);
    expect(report.totals.collectedAmount).toBe(100);
    expect(report.totals.outstandingAmount).toBe(0);
    expect(report.rows[1].reconciliationStatus).toBe('not_settled');
  });

  it('groups the report into daily, weekly and monthly summaries', async () => {
    paymentMock.findMany.mockResolvedValue([
      payment({ id: 'pay_1', txHash: 'tx_1', amount: '10', createdAt: new Date('2026-01-15') }),
      payment({ id: 'pay_2', txHash: 'tx_2', amount: '20', createdAt: new Date('2026-01-16') }),
      payment({ id: 'pay_3', txHash: 'tx_3', amount: '30', createdAt: new Date('2026-02-02') }),
    ]);

    const { report } = await reconciliationReportService.generateReport({
      ...FILTERS,
      dateTo: '2026-02-28',
    });

    expect(report.dailySummaries.map((day) => day.date)).toEqual([
      '2026-01-15',
      '2026-01-16',
      '2026-02-02',
    ]);
    expect(report.weeklySummaries.map((week) => week.week)).toEqual(['2026-01-12', '2026-02-02']);
    expect(report.monthlySummaries.map((month) => month.month)).toEqual(['2026-01', '2026-02']);
    expect(report.monthlySummaries[0]).toMatchObject({ txCount: 2, totalAmount: '30.00000000' });
  });

  it('exports a CSV with the exception column and the totals section', async () => {
    paymentMock.findMany.mockResolvedValue([payment({ txHash: null })]);

    const { csv } = await reconciliationReportService.generateReport(FILTERS);

    expect(csv).toContain('Metric,Value');
    expect(csv).toContain('Reconciliation Status');
    expect(csv).toContain('missing_tx_hash');
  });

  it('rejects an invalid date range before querying the ledger', async () => {
    await expect(
      reconciliationReportService.generateReport({ ...FILTERS, dateFrom: '2026-03-01' }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(paymentMock.findMany).not.toHaveBeenCalled();
  });
});
