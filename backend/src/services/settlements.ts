/**
 * settlements.ts — Issue #1635
 *
 * Keyset pagination for settlement ledger reads. Large settlement queries
 * used to rely on OFFSET, which makes the database walk and discard every
 * skipped row. This service pages on `(created_at, id)` so each page starts
 * from the previous page's last row and is backed by the composite covering
 * index added in `prisma/schema.prisma`.
 */

import { prisma } from '../lib/prisma.js';

export interface SettlementCursor {
  createdAt: string;
  id: string;
}

export interface SettlementQuery {
  tenantId: string;
  statuses?: string[];
  from?: string;
  to?: string;
  /** Maximum rows per page. Clamped to 1..500. */
  limit?: number;
  cursor?: SettlementCursor;
}

export interface SettlementRow {
  id: string;
  createdAt: string;
  status: string;
  amount: number;
  currency: string;
  network: string;
  type: string;
  toAddress: string | null;
  userId: string | null;
}

export interface SettlementPage {
  rows: SettlementRow[];
  nextCursor: SettlementCursor | null;
  meta: {
    tenantId: string;
    returned: number;
    usedCursor: boolean;
    durationMs: number;
  };
}

export interface LedgerRow {
  id: string;
  createdAt: Date;
  status: string;
  amount: { toNumber(): number } | number | string;
  currency: string;
  network: string;
  type: string;
  toAddress: string | null;
  userId: string | null;
}

/** Minimal seam so the query shape can be pinned without a live database. */
export interface SettlementClient {
  payment: {
    findMany(args: Record<string, unknown>): Promise<LedgerRow[]>;
  };
}

export interface SettlementLogEvent {
  event: 'settlements.keyset_query';
  tenantId: string;
  returned: number;
  usedCursor: boolean;
  durationMs: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function amountToNumber(amount: LedgerRow['amount']): number {
  if (typeof amount === 'number') return amount;
  if (typeof amount === 'string') return Number(amount);
  return amount.toNumber();
}

function toRow(row: LedgerRow): SettlementRow {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    amount: amountToNumber(row.amount),
    currency: row.currency,
    network: row.network,
    type: row.type,
    toAddress: row.toAddress,
    userId: row.userId,
  };
}

function defaultLogger(event: SettlementLogEvent): void {
  console.info(JSON.stringify(event));
}

export class SettlementQueryService {
  constructor(
    private readonly client: SettlementClient = prisma as unknown as SettlementClient,
    private readonly logger: (event: SettlementLogEvent) => void = defaultLogger,
  ) {}

  /** Returns one keyset page plus a cursor for the following page. */
  async listSettlements(query: SettlementQuery): Promise<SettlementPage> {
    const startedAt = Date.now();
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(query.limit ?? DEFAULT_LIMIT)));
    const cursor = query.cursor;
    const where: Record<string, unknown> = {
      tenantId: query.tenantId,
      deletedAt: null,
    };

    if (query.statuses?.length) {
      where.status = { in: query.statuses };
    }

    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      if (query.from) createdAt.gte = new Date(query.from);
      if (query.to) createdAt.lte = new Date(query.to);
      where.createdAt = createdAt;
    }

    if (cursor) {
      const cursorDate = new Date(cursor.createdAt);
      where.OR = [
        { createdAt: { lt: cursorDate } },
        { createdAt: cursorDate, id: { lt: cursor.id } },
      ];
    }

    const rows = await this.client.payment.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        status: true,
        amount: true,
        currency: true,
        network: true,
        type: true,
        toAddress: true,
        userId: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last
      ? { createdAt: last.createdAt.toISOString(), id: last.id }
      : null;

    const durationMs = Date.now() - startedAt;
    this.logger({
      event: 'settlements.keyset_query',
      tenantId: query.tenantId,
      returned: pageRows.length,
      usedCursor: Boolean(cursor),
      durationMs,
    });

    return {
      rows: pageRows.map(toRow),
      nextCursor,
      meta: {
        tenantId: query.tenantId,
        returned: pageRows.length,
        usedCursor: Boolean(cursor),
        durationMs,
      },
    };
  }

  /** Walks every matching settlement without accumulating all pages in memory. */
  async *iterateSettlements(
    query: Omit<SettlementQuery, 'cursor'>,
  ): AsyncGenerator<SettlementRow> {
    let cursor: SettlementCursor | undefined;
    do {
      const page = await this.listSettlements({ ...query, cursor });
      for (const row of page.rows) yield row;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
}

export const settlementQueryService = new SettlementQueryService();
