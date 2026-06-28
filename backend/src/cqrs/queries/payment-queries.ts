/**
 * Read-side query handlers for high-volume tables.
 * Handlers receive a Prisma client routed to a read replica (with primary fallback).
 */

import { registerQueryHandler, type Query } from '../query-bus.js';
import { prisma } from '../../lib/prisma.js';
import {
  getPaymentReadModel,
  getAllPayments,
  getTransactionSummaryProjection,
  getMerchantDailyAggregate,
} from '../projections/index.js';

// ── Query: get single payment read model ─────────────────────────────────────

export interface GetPaymentQuery extends Query<{ id: string; status: string; amount: number; asset: string } | null> {
  readonly _type: 'GetPayment';
  paymentId: string;
}

registerQueryHandler<GetPaymentQuery, { id: string; status: string; amount: number; asset: string } | null>(
  'GetPayment',
  async (query) => {
    // Prefer in-memory projection; fall back to DB on cache miss
    const projection = getPaymentReadModel(query.paymentId);
    if (projection) return { id: projection.paymentId, status: projection.status, amount: projection.amount, asset: projection.asset };

    const row = await prisma.payment.findUnique({ where: { id: query.paymentId } });
    if (!row) return null;
    return { id: row.id, status: row.status, amount: Number(row.amount), asset: row.currency };
  }
);

// ── Query: list payments (paginated) ─────────────────────────────────────────

export interface ListPaymentsQuery extends Query<{ items: unknown[]; total: number }> {
  readonly _type: 'ListPayments';
  tenantId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

registerQueryHandler<ListPaymentsQuery, { items: unknown[]; total: number }>(
  'ListPayments',
  async (query) => {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, query.pageSize ?? 20);
    const where = {
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      deletedAt: null,
    };
    const [items, total] = await Promise.all([
      prisma.payment.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }),
      prisma.payment.count({ where }),
    ]);
    return { items, total };
  }
);

// ── Query: transaction summary projection ────────────────────────────────────

export interface GetTransactionSummaryQuery extends Query<unknown> {
  readonly _type: 'GetTransactionSummary';
  tenantId?: string;
}

registerQueryHandler<GetTransactionSummaryQuery, unknown>(
  'GetTransactionSummary',
  async (query) => getTransactionSummaryProjection(query.tenantId)
);

// ── Query: merchant daily aggregate ─────────────────────────────────────────

export interface GetMerchantDailyAggregateQuery extends Query<unknown> {
  readonly _type: 'GetMerchantDailyAggregate';
  merchantId: string;
  date: string;
}

registerQueryHandler<GetMerchantDailyAggregateQuery, unknown>(
  'GetMerchantDailyAggregate',
  async (query) => getMerchantDailyAggregate(query.merchantId, query.date)
);


