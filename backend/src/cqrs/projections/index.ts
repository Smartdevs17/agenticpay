/**
 * Read model projections — denormalized views updated via event subscriptions.
 * transaction_summary: per-tenant payment summary.
 * merchant_daily_aggregate: daily aggregated totals per merchant.
 * Eventual consistency: in-memory updated on event publish (<1s target).
 */

import { subscribe } from '../../events/event-bus.js';
import type { StoredEvent } from '../../events/event-types.js';

// Re-export existing projections unchanged
export {
  getPaymentReadModel,
  getAllPayments,
  getProjectReadModel,
  getAllProjects,
  getVerificationReadModel,
  getAllVerifications,
} from '../../events/projections.js';

// ── transaction_summary read model ───────────────────────────────────────────

interface TransactionSummary {
  tenantId: string;
  totalCount: number;
  totalAmount: number;
  successCount: number;
  failedCount: number;
  lastUpdated: string;
}

const transactionSummaries = new Map<string, TransactionSummary>();

function getSummary(tenantId: string): TransactionSummary {
  return transactionSummaries.get(tenantId) ?? {
    tenantId,
    totalCount: 0,
    totalAmount: 0,
    successCount: 0,
    failedCount: 0,
    lastUpdated: new Date().toISOString(),
  };
}

subscribe('payment.created', (event: StoredEvent) => {
  const p = event.payload as { tenantId?: string; amount?: number };
  const tenantId = p.tenantId ?? 'default';
  const s = getSummary(tenantId);
  transactionSummaries.set(tenantId, {
    ...s,
    totalCount: s.totalCount + 1,
    totalAmount: s.totalAmount + (p.amount ?? 0),
    lastUpdated: new Date().toISOString(),
  });
});

subscribe('payment.executed', (event: StoredEvent) => {
  const p = event.payload as { tenantId?: string };
  const tenantId = p.tenantId ?? 'default';
  const s = getSummary(tenantId);
  transactionSummaries.set(tenantId, {
    ...s,
    successCount: s.successCount + 1,
    lastUpdated: new Date().toISOString(),
  });
});

subscribe('payment.failed', (event: StoredEvent) => {
  const p = event.payload as { tenantId?: string };
  const tenantId = p.tenantId ?? 'default';
  const s = getSummary(tenantId);
  transactionSummaries.set(tenantId, {
    ...s,
    failedCount: s.failedCount + 1,
    lastUpdated: new Date().toISOString(),
  });
});

export function getTransactionSummaryProjection(tenantId?: string): TransactionSummary | TransactionSummary[] {
  if (tenantId) return getSummary(tenantId);
  return Array.from(transactionSummaries.values());
}

// ── merchant_daily_aggregate read model ──────────────────────────────────────

interface MerchantDailyAggregate {
  merchantId: string;
  date: string;
  paymentCount: number;
  totalAmount: number;
  successCount: number;
  lastUpdated: string;
}

const merchantDailyAggregates = new Map<string, MerchantDailyAggregate>();

function dailyKey(merchantId: string, date: string): string {
  return `${merchantId}:${date}`;
}

function getDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

subscribe('payment.created', (event: StoredEvent) => {
  const p = event.payload as { merchantId?: string; tenantId?: string; amount?: number };
  const merchantId = p.merchantId ?? p.tenantId ?? 'default';
  const date = getDateStr();
  const k = dailyKey(merchantId, date);
  const existing = merchantDailyAggregates.get(k) ?? { merchantId, date, paymentCount: 0, totalAmount: 0, successCount: 0, lastUpdated: '' };
  merchantDailyAggregates.set(k, {
    ...existing,
    paymentCount: existing.paymentCount + 1,
    totalAmount: existing.totalAmount + (p.amount ?? 0),
    lastUpdated: new Date().toISOString(),
  });
});

subscribe('payment.executed', (event: StoredEvent) => {
  const p = event.payload as { merchantId?: string; tenantId?: string };
  const merchantId = p.merchantId ?? p.tenantId ?? 'default';
  const date = getDateStr();
  const k = dailyKey(merchantId, date);
  const existing = merchantDailyAggregates.get(k) ?? { merchantId, date, paymentCount: 0, totalAmount: 0, successCount: 0, lastUpdated: '' };
  merchantDailyAggregates.set(k, {
    ...existing,
    successCount: existing.successCount + 1,
    lastUpdated: new Date().toISOString(),
  });
});

export function getMerchantDailyAggregate(merchantId: string, date?: string): MerchantDailyAggregate | undefined {
  return merchantDailyAggregates.get(dailyKey(merchantId, date ?? getDateStr()));
}

export function rebuildProjections(): void {
  transactionSummaries.clear();
  merchantDailyAggregates.clear();
}
