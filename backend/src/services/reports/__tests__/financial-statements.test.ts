import { beforeEach, describe, expect, it, vi } from 'vitest';

const paymentMock = { findMany: vi.fn() };
const reportJobMock = {
  create: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
};
const reportArchiveMock = { create: vi.fn() };

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    payment: paymentMock,
    reportJob: reportJobMock,
    reportArchive: reportArchiveMock,
  },
}));

const { financialStatementService } = await import('../financial-statements.js');

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

describe('financialStatementService.generateStatement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REPORT_PLATFORM_FEE_BPS;
  });

  it('builds an income statement, balance sheet and cash flow from settled payments', async () => {
    paymentMock.findMany.mockResolvedValue([
      payment({ id: 'pay_1', txHash: 'tx_1', amount: '100', createdAt: new Date('2026-01-15') }),
      payment({ id: 'pay_2', txHash: 'tx_2', amount: '50', createdAt: new Date('2026-01-16') }),
    ]);

    const { statement } = await financialStatementService.generateStatement(FILTERS);

    expect(statement.incomeStatement).toEqual([
      { label: 'Gross revenue', amount: 150 },
      { label: 'Refunds and reversals', amount: 0 },
      { label: 'Net revenue', amount: 150 },
      { label: 'Platform fees', amount: 0 },
      { label: 'Net income', amount: 150 },
    ]);

    expect(statement.balanceSheet.totalAssets).toBe(150);
    expect(statement.balanceSheet.totalLiabilities).toBe(0);
    expect(statement.balanceSheet.totalEquity).toBe(150);
    expect(statement.balanceSheet.balanced).toBe(true);

    expect(statement.cashFlow).toEqual([
      { label: 'Cash inflows from customers', amount: 150 },
      { label: 'Cash outflows for refunds and reversals', amount: 0 },
      { label: 'Platform fees collected', amount: 0 },
      { label: 'Net change in cash', amount: 150 },
    ]);

    expect(statement.totals).toMatchObject({
      txCount: 2,
      grossVolume: 150,
      netVolume: 150,
      totalFees: 0,
      completedCount: 2,
      failedCount: 0,
      pendingCount: 0,
    });
  });

  it('keeps refunds and reversals out of revenue', async () => {
    paymentMock.findMany.mockResolvedValue([
      payment({ id: 'pay_1', txHash: 'tx_1', amount: '20', type: 'refund', status: 'completed' }),
      payment({ id: 'pay_2', txHash: 'tx_2', amount: '30', status: 'refunded' }),
    ]);

    const { statement } = await financialStatementService.generateStatement(FILTERS);

    expect(statement.totals.grossVolume).toBe(0);
    expect(statement.totals.refundedVolume).toBe(50);
    expect(statement.totals.refundedCount).toBe(1);
    expect(statement.totals.reversedCount).toBe(1);
    expect(statement.incomeStatement[1]).toEqual({ label: 'Refunds and reversals', amount: -50 });
    expect(statement.balanceSheet.balanced).toBe(true);
  });

  it('treats pending payments as receivables rather than revenue', async () => {
    paymentMock.findMany.mockResolvedValue([
      payment({ id: 'pay_1', txHash: null, amount: '30', status: 'pending' }),
    ]);

    const { statement } = await financialStatementService.generateStatement(FILTERS);

    expect(statement.totals.grossVolume).toBe(0);
    expect(statement.totals.receivableVolume).toBe(30);
    expect(statement.totals.pendingCount).toBe(1);
    expect(statement.balanceSheet.assets).toContainEqual({ label: 'Accounts receivable', amount: 30 });
    expect(statement.balanceSheet.balanced).toBe(true);
  });

  it('charges the configured platform fee and reports it on every statement', async () => {
    paymentMock.findMany.mockResolvedValue([payment({ amount: '100' })]);

    const { statement } = await financialStatementService.generateStatement({ ...FILTERS, feeBps: 100 });

    expect(statement.feeBps).toBe(100);
    expect(statement.totals.totalFees).toBe(1);
    expect(statement.totals.netVolume).toBe(99);
    expect(statement.transactions[0]).toMatchObject({ amount: 100, fee: 1, net: 99 });
  });

  it('groups settled payments into daily and monthly summaries', async () => {
    paymentMock.findMany.mockResolvedValue([
      payment({ id: 'pay_1', txHash: 'tx_1', amount: '10', createdAt: new Date('2026-01-15') }),
      payment({ id: 'pay_2', txHash: 'tx_2', amount: '20', createdAt: new Date('2026-01-16') }),
      payment({ id: 'pay_3', txHash: 'tx_3', amount: '30', createdAt: new Date('2026-02-02') }),
    ]);

    const { statement } = await financialStatementService.generateStatement({
      ...FILTERS,
      dateTo: '2026-02-28',
    });

    expect(statement.daily.map((day) => day.period)).toEqual([
      '2026-01-15',
      '2026-01-16',
      '2026-02-02',
    ]);
    expect(statement.daily[0]).toMatchObject({ txCount: 1, grossVolume: 10 });
    expect(statement.monthly.map((month) => month.period)).toEqual(['2026-01', '2026-02']);
    expect(statement.monthly[0]).toMatchObject({ txCount: 2, grossVolume: 30 });
  });

  it('exports a CSV containing the statement sections and the transaction rows', async () => {
    paymentMock.findMany.mockResolvedValue([payment({ amount: '100' })]);

    const { csv } = await financialStatementService.generateStatement(FILTERS);

    expect(csv).toContain('Statement,Line,Amount');
    expect(csv).toContain('Income statement,Gross revenue,100.00000000');
    expect(csv).toContain('Date,Chain,Currency,Type,Amount,Fee,Net,Status,Transaction ID');
    expect(csv).toContain('2026-01-15,stellar,XLM,milestone_payment,100.00000000');
  });

  it('rejects a date range that is missing or reversed', async () => {
    await expect(
      financialStatementService.generateStatement({ tenantId: 'tenant_1', dateFrom: '', dateTo: '' }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      financialStatementService.generateStatement({
        tenantId: 'tenant_1',
        dateFrom: '2026-02-01',
        dateTo: '2026-01-01',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(paymentMock.findMany).not.toHaveBeenCalled();
  });
});

describe('financialStatementService.generateStatementJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REPORT_PLATFORM_FEE_BPS;
    reportJobMock.create.mockResolvedValue({ id: 'job_1' });
    reportJobMock.update.mockResolvedValue({});
    reportArchiveMock.create.mockResolvedValue({});
  });

  it('records the run as a report job and archives the result', async () => {
    paymentMock.findMany.mockResolvedValue([payment({ amount: '100' })]);

    const result = await financialStatementService.generateStatementJob(FILTERS, 'usr_1');

    expect(result.jobId).toBe('job_1');
    expect(reportJobMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant_1',
          userId: 'usr_1',
          type: 'financial_statement',
          status: 'generating',
        }),
      }),
    );
    expect(reportJobMock.update).toHaveBeenCalledWith({
      where: { id: 'job_1' },
      data: expect.objectContaining({ status: 'completed', progress: 100 }),
    });
    expect(reportArchiveMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reportId: 'job_1', rowCount: 1 }) }),
    );
  });

  it('marks the job as failed when generation fails', async () => {
    paymentMock.findMany.mockRejectedValue(new Error('ledger unavailable'));

    await expect(financialStatementService.generateStatementJob(FILTERS)).rejects.toThrow(
      'ledger unavailable',
    );

    expect(reportJobMock.update).toHaveBeenCalledWith({
      where: { id: 'job_1' },
      data: expect.objectContaining({ status: 'failed', errorMessage: 'ledger unavailable' }),
    });
    expect(reportArchiveMock.create).not.toHaveBeenCalled();
  });
});
