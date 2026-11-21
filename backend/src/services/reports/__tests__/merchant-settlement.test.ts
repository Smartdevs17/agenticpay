import { beforeEach, describe, expect, it, vi } from 'vitest';

const paymentMock = { findMany: vi.fn() };
const reportJobMock = { create: vi.fn(), update: vi.fn() };
const reportArchiveMock = { create: vi.fn() };

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    payment: paymentMock,
    reportJob: reportJobMock,
    reportArchive: reportArchiveMock,
  },
}));

const { merchantSettlementService } = await import('../merchant-settlement.js');

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
    toAddress: 'G_MERCHANT_A',
    metadata: null,
    createdAt: new Date('2026-01-15T00:00:00.000Z'),
    updatedAt: new Date('2026-01-15T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

const FILTERS = { tenantId: 'tenant_1', dateFrom: '2026-01-01', dateTo: '2026-01-31' };

describe('merchantSettlementService.generateReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REPORT_PLATFORM_FEE_BPS;
  });

  it('settles each merchant separately', async () => {
    paymentMock.findMany.mockResolvedValue([
      payment({ id: 'pay_1', txHash: 'tx_1', amount: '100', toAddress: 'G_MERCHANT_A' }),
      payment({ id: 'pay_2', txHash: 'tx_2', amount: '40', toAddress: 'G_MERCHANT_A' }),
      payment({ id: 'pay_3', txHash: 'tx_3', amount: '70', toAddress: 'G_MERCHANT_B' }),
    ]);

    const { report } = await merchantSettlementService.generateReport(FILTERS);

    expect(report.merchants).toHaveLength(2);

    const merchantA = report.merchants.find((merchant) => merchant.merchantId === 'G_MERCHANT_A');
    expect(merchantA).toMatchObject({
      transactionCount: 2,
      grossCollected: 140,
      fees: 0,
      netSettlement: 140,
    });

    const merchantB = report.merchants.find((merchant) => merchant.merchantId === 'G_MERCHANT_B');
    expect(merchantB).toMatchObject({ transactionCount: 1, grossCollected: 70, netSettlement: 70 });

    expect(report.totals).toMatchObject({
      merchantCount: 2,
      transactionCount: 3,
      grossCollected: 210,
      netSettlement: 210,
    });
  });

  it('falls back to the paying user when the payment has no settlement address', async () => {
    paymentMock.findMany.mockResolvedValue([payment({ toAddress: null, userId: 'usr_9' })]);

    const { report } = await merchantSettlementService.generateReport(FILTERS);

    expect(report.merchants[0].merchantId).toBe('usr_9');
  });

  it('keeps refunds and reversals out of the net settlement', async () => {
    paymentMock.findMany.mockResolvedValue([
      payment({ id: 'pay_1', txHash: 'tx_1', amount: '100', type: 'refund', status: 'completed' }),
      payment({ id: 'pay_2', txHash: 'tx_2', amount: '30', status: 'refunded' }),
      payment({ id: 'pay_3', txHash: 'tx_3', amount: '25', status: 'pending' }),
      payment({ id: 'pay_4', txHash: 'tx_4', amount: '15', status: 'failed' }),
    ]);

    const { report } = await merchantSettlementService.generateReport(FILTERS);

    expect(report.merchants[0]).toMatchObject({
      grossCollected: 0,
      refunds: 100,
      reversals: 30,
      netSettlement: 0,
      inFlight: 25,
      failedAmount: 15,
    });
  });

  it('charges the configured platform fee against the settlement', async () => {
    paymentMock.findMany.mockResolvedValue([payment({ amount: '100' })]);

    const { report } = await merchantSettlementService.generateReport({ ...FILTERS, feeBps: 100 });

    expect(report.feeBps).toBe(100);
    expect(report.merchants[0]).toMatchObject({ grossCollected: 100, fees: 1, netSettlement: 99 });
  });

  it('narrows the report to a single merchant when one is requested', async () => {
    paymentMock.findMany.mockResolvedValue([
      payment({ id: 'pay_1', txHash: 'tx_1', amount: '100', toAddress: 'G_MERCHANT_A' }),
      payment({ id: 'pay_2', txHash: 'tx_2', amount: '70', toAddress: 'G_MERCHANT_B' }),
    ]);

    const { report } = await merchantSettlementService.generateReport({
      ...FILTERS,
      merchantId: 'G_MERCHANT_A',
    });

    expect(report.merchants).toHaveLength(1);
    expect(report.merchants[0].merchantId).toBe('G_MERCHANT_A');
    expect(report.totals.grossCollected).toBe(100);
  });

  it('exports a CSV with a merchant row per settlement account', async () => {
    paymentMock.findMany.mockResolvedValue([payment({ amount: '100' })]);

    const { csv } = await merchantSettlementService.generateReport(FILTERS);

    expect(csv).toContain('Merchant,Transactions,Gross Collected');
    expect(csv).toContain('G_MERCHANT_A,1,100.00000000');
  });

  it('rejects an invalid date range before querying the ledger', async () => {
    await expect(
      merchantSettlementService.generateReport({ ...FILTERS, dateTo: '2025-12-31' }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(paymentMock.findMany).not.toHaveBeenCalled();
  });
});

describe('merchantSettlementService.generateSettlementJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REPORT_PLATFORM_FEE_BPS;
    reportJobMock.create.mockResolvedValue({ id: 'job_9' });
    reportJobMock.update.mockResolvedValue({});
    reportArchiveMock.create.mockResolvedValue({});
  });

  it('records the run as a settlement report job', async () => {
    paymentMock.findMany.mockResolvedValue([payment({ amount: '100' })]);

    const result = await merchantSettlementService.generateSettlementJob(FILTERS, 'usr_1');

    expect(result.jobId).toBe('job_9');
    expect(reportJobMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'settlement', status: 'generating', userId: 'usr_1' }),
      }),
    );
    expect(reportJobMock.update).toHaveBeenCalledWith({
      where: { id: 'job_9' },
      data: expect.objectContaining({ status: 'completed', progress: 100 }),
    });
  });

  it('marks the job as failed when the report cannot be generated', async () => {
    paymentMock.findMany.mockRejectedValue(new Error('ledger unavailable'));

    await expect(merchantSettlementService.generateSettlementJob(FILTERS)).rejects.toThrow(
      'ledger unavailable',
    );

    expect(reportJobMock.update).toHaveBeenCalledWith({
      where: { id: 'job_9' },
      data: expect.objectContaining({ status: 'failed' }),
    });
  });
});
