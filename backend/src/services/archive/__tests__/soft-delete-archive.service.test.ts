import { describe, it, expect, vi, beforeEach } from 'vitest';

const payment = {
  updateMany: vi.fn(async () => ({ count: 1 })),
  findMany: vi.fn(async () => []),
  deleteMany: vi.fn(async () => ({ count: 0 })),
};

const archivedRecord = {
  createMany: vi.fn(async () => ({ count: 0 })),
  findMany: vi.fn(async () => []),
  findUnique: vi.fn(async () => null),
  delete: vi.fn(async () => undefined),
};

const txClient = { payment, archivedRecord };

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    payment,
    archivedRecord,
    $transaction: vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient)),
  },
}));

import { prisma } from '../../../lib/prisma.js';
import {
  softDelete,
  restoreSoftDeleted,
  archiveExpiredSoftDeletes,
  restoreFromArchive,
} from '../soft-delete-archive.service.js';

describe('soft-delete-archive.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('softDelete sets deletedAt only for non-deleted rows', async () => {
    await softDelete('Payment', 'p1');
    expect(payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('restoreSoftDeleted clears deletedAt', async () => {
    await restoreSoftDeleted('Payment', 'p1');
    expect(payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', NOT: { deletedAt: null } },
      data: { deletedAt: null },
    });
  });

  it('archiveExpiredSoftDeletes is a no-op when nothing is past retention', async () => {
    payment.findMany.mockResolvedValueOnce([]);
    const result = await archiveExpiredSoftDeletes('Payment');
    expect(result).toEqual({ model: 'Payment', archivedCount: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('archiveExpiredSoftDeletes copies rows to archived_records and purges them', async () => {
    const oldDate = new Date('2020-01-01T00:00:00Z');
    payment.findMany.mockResolvedValueOnce([
      { id: 'p1', tenantId: 't1', deletedAt: oldDate, amount: '10' },
    ]);

    const result = await archiveExpiredSoftDeletes('Payment', { retentionDays: 30 });

    expect(result).toEqual({ model: 'Payment', archivedCount: 1 });
    expect(archivedRecord.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ modelName: 'Payment', recordId: 'p1', tenantId: 't1' }),
        ],
      }),
    );
    expect(payment.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['p1'] } } });
  });

  it('restoreFromArchive throws when the archived record is missing', async () => {
    archivedRecord.findUnique.mockResolvedValueOnce(null);
    await expect(restoreFromArchive('Payment', 'missing')).rejects.toThrow(/No archived record/);
  });
});
