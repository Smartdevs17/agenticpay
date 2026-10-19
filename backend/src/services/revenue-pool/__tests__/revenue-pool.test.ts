import { describe, expect, it, vi, beforeEach } from 'vitest';

const revenuePoolMock = { findFirst: vi.fn() };
const revenueRecipientMock = {
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  aggregate: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
const revenueDistributionMock = { findFirst: vi.fn(), create: vi.fn() };

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    revenuePool: revenuePoolMock,
    revenueRecipient: revenueRecipientMock,
    revenueDistribution: revenueDistributionMock,
  },
}));

const { TOTAL_SHARE_BPS, revenuePoolService } = await import('../index.js');

const TENANT = 'tenant_1';
const POOL = 'pool_1';

function givenPool() {
  revenuePoolMock.findFirst.mockResolvedValue({ id: POOL, tenantId: TENANT, deletedAt: null });
}

describe('RevenuePoolService recipient allocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    givenPool();
    revenueRecipientMock.aggregate.mockResolvedValue({ _sum: { ratioBps: 0 } });
    revenueRecipientMock.findUnique.mockResolvedValue(null);
  });

  it('accepts a recipient that keeps the pool at or below 100%', async () => {
    revenueRecipientMock.aggregate.mockResolvedValue({ _sum: { ratioBps: 6000 } });
    revenueRecipientMock.create.mockResolvedValue({ poolId: POOL, wallet: 'wallet_b', ratioBps: 4000 });

    const result = await revenuePoolService.addRecipient(POOL, TENANT, { wallet: 'wallet_b', ratioBps: 4000 });

    expect(result.ok).toBe(true);
  });

  it('rejects recipients whose shares would pay out more than the pool holds', async () => {
    // Two thirds already allocated; a third recipient at 50% would total 116%.
    revenueRecipientMock.aggregate.mockResolvedValue({ _sum: { ratioBps: 6600 } });

    const result = await revenuePoolService.addRecipient(POOL, TENANT, { wallet: 'wallet_b', ratioBps: 5000 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.statusCode).toBe(400);
      expect(result.error.message).toContain('11600');
      expect(result.error.details).toMatchObject({ allocatedBps: 6600, requestedBps: 5000 });
    }
    expect(revenueRecipientMock.create).not.toHaveBeenCalled();
  });

  it('rejects a ratio that is individually over 100%', async () => {
    const result = await revenuePoolService.addRecipient(POOL, TENANT, {
      wallet: 'wallet_b',
      ratioBps: TOTAL_SHARE_BPS + 1,
    });

    expect(result.ok).toBe(false);
    expect(revenueRecipientMock.create).not.toHaveBeenCalled();
  });

  it('rejects a ratio update that would push the pool over 100%', async () => {
    // wallet_a holds 4000 of an 8000 bps allocation; raising it to 8000 would total 12000.
    revenueRecipientMock.aggregate.mockResolvedValue({ _sum: { ratioBps: 8000 } });
    revenueRecipientMock.findUnique.mockResolvedValue({ poolId: POOL, wallet: 'wallet_a', ratioBps: 4000 });

    const result = await revenuePoolService.updateRecipientRatio(POOL, 'wallet_a', TENANT, { ratioBps: 8000 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.statusCode).toBe(400);
      expect(result.error.message).toContain('12000');
    }
    expect(revenueRecipientMock.update).not.toHaveBeenCalled();
  });

  it('allows a ratio update that stays within the allocation ceiling', async () => {
    revenueRecipientMock.aggregate.mockResolvedValue({ _sum: { ratioBps: 8000 } });
    revenueRecipientMock.findUnique.mockResolvedValue({ poolId: POOL, wallet: 'wallet_a', ratioBps: 4000 });
    revenueRecipientMock.update.mockResolvedValue({ poolId: POOL, wallet: 'wallet_a', ratioBps: 4000 });

    const result = await revenuePoolService.updateRecipientRatio(POOL, 'wallet_a', TENANT, { ratioBps: 4000 });

    expect(result.ok).toBe(true);
  });

  it('reports a missing recipient on update instead of crashing', async () => {
    revenueRecipientMock.findUnique.mockResolvedValue(null);

    const result = await revenuePoolService.updateRecipientRatio(POOL, 'wallet_missing', TENANT, { ratioBps: 1000 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.statusCode).toBe(404);
  });

  it('reports a missing recipient on removal instead of surfacing a 500', async () => {
    revenueRecipientMock.findUnique.mockResolvedValue(null);

    const result = await revenuePoolService.removeRecipient(POOL, 'wallet_missing', TENANT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.statusCode).toBe(404);
    expect(revenueRecipientMock.delete).not.toHaveBeenCalled();
  });
});

describe('RevenuePoolService distribution recording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    givenPool();
  });

  it('records a distribution once', async () => {
    revenueDistributionMock.findFirst.mockResolvedValue(null);
    revenueDistributionMock.create.mockResolvedValue({ id: 'dist_1', poolId: POOL, txHash: 'tx_1' });

    const result = await revenuePoolService.recordDistribution(POOL, TENANT, { txHash: 'tx_1', amount: '10.00' });

    expect(result.ok).toBe(true);
    expect(revenueDistributionMock.create).toHaveBeenCalledTimes(1);
  });

  it('returns the existing distribution when the same transaction is replayed', async () => {
    revenueDistributionMock.findFirst.mockResolvedValue({ id: 'dist_1', poolId: POOL, txHash: 'tx_1' });

    const result = await revenuePoolService.recordDistribution(POOL, TENANT, { txHash: 'tx_1', amount: '10.00' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe('dist_1');
    expect(revenueDistributionMock.create).not.toHaveBeenCalled();
  });

  it('still requires a transaction hash', async () => {
    const result = await revenuePoolService.recordDistribution(POOL, TENANT, { txHash: '  ', amount: '10.00' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.statusCode).toBe(400);
  });
});