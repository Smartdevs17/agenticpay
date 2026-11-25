import { describe, expect, it, vi } from 'vitest';
import { SettlementQueryService, type LedgerRow } from '../settlements.js';

function row(id: string, createdAt: string): LedgerRow {
  return {
    id,
    createdAt: new Date(createdAt),
    status: 'completed',
    amount: { toNumber: () => 12.5 },
    currency: 'XLM',
    network: 'stellar',
    type: 'milestone_payment',
    toAddress: 'GABC',
    userId: null,
  };
}

describe('SettlementQueryService', () => {
  it('uses a keyset predicate with an id tie-breaker instead of OFFSET', async () => {
    const findMany = vi.fn().mockResolvedValue([row('a', '2026-01-01T00:00:00Z')]);
    const service = new SettlementQueryService(
      { payment: { findMany } },
      vi.fn(),
    );

    await service.listSettlements({
      tenantId: 't1',
      limit: 10,
      cursor: { createdAt: '2026-01-01T00:00:00Z', id: 'a' },
    });

    const args = findMany.mock.calls[0][0] as Record<string, any>;
    expect(args.skip).toBeUndefined();
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.where.OR).toEqual([
      { createdAt: { lt: new Date('2026-01-01T00:00:00Z') } },
      { createdAt: new Date('2026-01-01T00:00:00Z'), id: { lt: 'a' } },
    ]);
  });

  it('fetches limit + 1 rows and returns a cursor only when more exist', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        row('a', '2026-01-03T00:00:00Z'),
        row('b', '2026-01-02T00:00:00Z'),
        row('c', '2026-01-01T00:00:00Z'),
      ])
      .mockResolvedValueOnce([row('c', '2026-01-01T00:00:00Z')]);
    const service = new SettlementQueryService(
      { payment: { findMany } },
      vi.fn(),
    );

    const first = await service.listSettlements({ tenantId: 't1', limit: 2 });
    expect(first.rows.map((item) => item.id)).toEqual(['a', 'b']);
    expect(first.nextCursor).toEqual({
      createdAt: '2026-01-02T00:00:00Z',
      id: 'b',
    });

    const second = await service.listSettlements({
      tenantId: 't1',
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.rows.map((item) => item.id)).toEqual(['c']);
    expect(second.nextCursor).toBeNull();
  });

  it('emits an observability event for each query', async () => {
    const logger = vi.fn();
    const service = new SettlementQueryService(
      { payment: { findMany: vi.fn().mockResolvedValue([row('a', '2026-01-01T00:00:00Z')]) } },
      logger,
    );

    await service.listSettlements({ tenantId: 't1' });

    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger.mock.calls[0][0]).toMatchObject({
      event: 'settlements.keyset_query',
      tenantId: 't1',
      returned: 1,
      usedCursor: false,
    });
  });

  it('iterates pages without requesting an offset', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([row('a', '2026-01-02T00:00:00Z'), row('b', '2026-01-01T00:00:00Z')])
      .mockResolvedValueOnce([row('b', '2026-01-01T00:00:00Z')]);
    const service = new SettlementQueryService(
      { payment: { findMany } },
      vi.fn(),
    );

    const ids: string[] = [];
    for await (const item of service.iterateSettlements({ tenantId: 't1', limit: 1 })) {
      ids.push(item.id);
    }

    expect(ids).toEqual(['a', 'b']);
    expect((findMany.mock.calls[0][0] as Record<string, unknown>).skip).toBeUndefined();
  });
});
