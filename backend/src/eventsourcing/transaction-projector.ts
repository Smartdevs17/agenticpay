/**
 * transaction-projector.ts — Issue #946
 *
 * Read-model projection for transactions. Maintains a denormalized view of
 * transaction state keyed by transaction id, updated from domain events.
 *
 * In production this would write to a dedicated read table or search index.
 * Here it maintains an in-memory map for demonstration and testing.
 */

import type { StoredEvent } from './types.js';
import { Projection } from './projection.js';

interface TransactionReadModel {
  id: string;
  status: string;
  amount: number;
  currency: string;
  toAddress: string;
  providerId?: string;
  txHash?: string;
  refundedAmount: number;
  updatedAt: string;
}

export class TransactionProjector extends Projection {
  protected readonly name = 'transaction-read-model';
  protected readonly eventTypes = [
    'TransactionCreated',
    'PaymentAuthorized',
    'PaymentCaptured',
    'PaymentFailed',
    'TransactionRefunded',
    'TransactionCancelled',
  ];

  private readonly models = new Map<string, TransactionReadModel>();

  getReadModel(aggregateId: string): TransactionReadModel | undefined {
    return this.models.get(aggregateId);
  }

  getAll(): TransactionReadModel[] {
    return Array.from(this.models.values());
  }

  private onTransactionCreated(event: StoredEvent): void {
    const p = event.payload as TransactionReadModel & { fromAddress?: string; network?: string };
    this.models.set(event.aggregateId, {
      id: event.aggregateId,
      status: 'pending',
      amount: p.amount ?? 0,
      currency: p.currency ?? 'XLM',
      toAddress: p.toAddress ?? '',
      refundedAmount: 0,
      updatedAt: event.occurredAt,
    });
  }

  private onPaymentAuthorized(event: StoredEvent): void {
    const model = this.models.get(event.aggregateId);
    if (!model) return;
    const p = event.payload as { providerId?: string; txHash?: string };
    this.models.set(event.aggregateId, {
      ...model,
      status: 'authorized',
      providerId: p.providerId,
      txHash: p.txHash,
      updatedAt: event.occurredAt,
    });
  }

  private onPaymentCaptured(event: StoredEvent): void {
    const model = this.models.get(event.aggregateId);
    if (!model) return;
    this.models.set(event.aggregateId, {
      ...model,
      status: 'captured',
      updatedAt: event.occurredAt,
    });
  }

  private onPaymentFailed(event: StoredEvent): void {
    const model = this.models.get(event.aggregateId);
    if (!model) return;
    this.models.set(event.aggregateId, {
      ...model,
      status: 'failed',
      updatedAt: event.occurredAt,
    });
  }

  private onTransactionRefunded(event: StoredEvent): void {
    const model = this.models.get(event.aggregateId);
    if (!model) return;
    const p = event.payload as { amount?: number };
    const refunded = (model.refundedAmount ?? 0) + (p.amount ?? 0);
    this.models.set(event.aggregateId, {
      ...model,
      status: refunded >= model.amount ? 'refunded' : model.status,
      refundedAmount: refunded,
      updatedAt: event.occurredAt,
    });
  }

  private onTransactionCancelled(event: StoredEvent): void {
    const model = this.models.get(event.aggregateId);
    if (!model) return;
    this.models.set(event.aggregateId, {
      ...model,
      status: 'cancelled',
      updatedAt: event.occurredAt,
    });
  }
}

/** Singleton accessor. */
let _projector: TransactionProjector | null = null;

export function getTransactionProjector(): TransactionProjector {
  if (!_projector) _projector = new TransactionProjector();
  return _projector;
}

export function resetTransactionProjectorForTesting(): void {
  _projector = null;
}
