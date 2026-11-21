/**
 * transaction-aggregate.ts — Issue #946
 *
 * Transaction aggregate root implementing event sourcing for payment
 * transactions. State transitions are expressed as domain events:
 *
 *   TransactionCreated → PaymentAuthorized → PaymentCaptured
 *                                    ↳ PaymentFailed
 *                                    ↳ TransactionRefunded
 *
 * Each command validates invariants before emitting its event.
 */

import { ok, err, type Result } from '../../lib/result.js';
import { AggregateRoot, type AggregateState } from './aggregate.js';
import type { StoredEvent } from './types.js';

export type TransactionStatus = 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'cancelled';

export interface TransactionState extends AggregateState {
  status: TransactionStatus;
  amount: number;
  currency: string;
  toAddress: string;
  fromAddress?: string;
  network: string;
  providerId?: string;
  txHash?: string;
  failureReason?: string;
  refundedAmount: number;
  createdAt: string;
  updatedAt: string;
}

const initialState = (overrides: Partial<TransactionState> = {}): TransactionState => ({
  status: 'pending',
  amount: 0,
  currency: 'XLM',
  toAddress: '',
  network: 'stellar',
  refundedAmount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

export class TransactionAggregate extends AggregateRoot<TransactionState> {
  protected readonly aggregateType = 'transaction';
  protected readonly id: string;

  constructor(id: string, initial?: TransactionState) {
    super(initial ?? initialState({ id }));
    this.id = id;
  }

  protected apply(event: StoredEvent): void {
    switch (event.eventType) {
      case 'TransactionCreated': {
        const p = event.payload as Partial<TransactionState>;
        this.state = {
          ...this.state,
          status: 'pending',
          amount: p.amount ?? 0,
          currency: p.currency ?? 'XLM',
          toAddress: p.toAddress ?? '',
          fromAddress: p.fromAddress,
          network: p.network ?? 'stellar',
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
        };
        break;
      }
      case 'PaymentAuthorized': {
        const p = event.payload as { providerId?: string; txHash?: string };
        this.state = {
          ...this.state,
          status: 'authorized',
          providerId: p.providerId ?? this.state.providerId,
          txHash: p.txHash ?? this.state.txHash,
          updatedAt: event.occurredAt,
        };
        break;
      }
      case 'PaymentCaptured': {
        this.state = { ...this.state, status: 'captured', updatedAt: event.occurredAt };
        break;
      }
      case 'PaymentFailed': {
        const p = event.payload as { reason?: string };
        this.state = {
          ...this.state,
          status: 'failed',
          failureReason: p.reason,
          updatedAt: event.occurredAt,
        };
        break;
      }
      case 'TransactionRefunded': {
        const p = event.payload as { amount?: number };
        const refunded = (this.state.refundedAmount ?? 0) + (p.amount ?? 0);
        this.state = {
          ...this.state,
          status: refunded >= this.state.amount ? 'refunded' : 'partially_refunded',
          refundedAmount: refunded,
          updatedAt: event.occurredAt,
        };
        break;
      }
      case 'TransactionCancelled': {
        this.state = { ...this.state, status: 'cancelled', updatedAt: event.occurredAt };
        break;
      }
    }
  }

  /** Create a new transaction. Idempotent: rejected if already created. */
  async createTransaction(
    input: { amount: number; currency: string; toAddress: string; fromAddress?: string; network?: string; userId?: string },
  ): Promise<Result<TransactionState>> {
    if (this.version > 0) {
      return err({
        code: 'TRANSACTION_ALREADY_EXISTS',
        message: `Transaction ${this.id} already exists`,
        statusCode: 409,
      });
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return err({
        code: 'INVALID_AMOUNT',
        message: 'Transaction amount must be a finite number greater than zero',
        statusCode: 400,
      });
    }

    await this.commit('TransactionCreated', {
      amount: input.amount,
      currency: input.currency,
      toAddress: input.toAddress,
      fromAddress: input.fromAddress,
      network: input.network ?? 'stellar',
      userId: input.userId,
    });

    return ok(this.state);
  }

  /** Authorize a payment against a downstream provider. */
  async authorizePayment(input: { providerId: string; txHash?: string; userId?: string }): Promise<Result<TransactionState>> {
    if (this.state.status !== 'pending') {
      return err({
        code: 'INVALID_TRANSITION',
        message: `Cannot authorize transaction in state ${this.state.status}`,
        statusCode: 409,
      });
    }

    await this.commit('PaymentAuthorized', {
      providerId: input.providerId,
      txHash: input.txHash,
      userId: input.userId,
    });

    return ok(this.state);
  }

  /** Capture an authorized payment. */
  async capturePayment(userId?: string): Promise<Result<TransactionState>> {
    if (this.state.status !== 'authorized') {
      return err({
        code: 'INVALID_TRANSITION',
        message: `Cannot capture transaction in state ${this.state.status}`,
        statusCode: 409,
      });
    }

    await this.commit('PaymentCaptured', {}, { userId });
    return ok(this.state);
  }

  /** Mark a payment as failed. */
  async failPayment(reason: string, userId?: string): Promise<Result<TransactionState>> {
    if (this.state.status === 'captured' || this.state.status === 'refunded') {
      return err({
        code: 'INVALID_TRANSITION',
        message: `Cannot fail transaction in state ${this.state.status}`,
        statusCode: 409,
      });
    }

    await this.commit('PaymentFailed', { reason }, { userId });
    return ok(this.state);
  }

  /** Refund part or all of a captured transaction. */
  async refund(input: { amount: number; userId?: string }): Promise<Result<TransactionState>> {
    if (this.state.status !== 'captured' && this.state.status !== 'authorized') {
      return err({
        code: 'INVALID_TRANSITION',
        message: `Cannot refund transaction in state ${this.state.status}`,
        statusCode: 409,
      });
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return err({
        code: 'INVALID_AMOUNT',
        message: 'Refund amount must be greater than zero',
        statusCode: 400,
      });
    }
    if (input.amount + this.state.refundedAmount > this.state.amount) {
      return err({
        code: 'REFUND_EXCEEDS_AMOUNT',
        message: 'Refund amount exceeds the remaining transaction amount',
        statusCode: 400,
      });
    }

    await this.commit('TransactionRefunded', { amount: input.amount }, { userId });
    return ok(this.state);
  }

  /** Cancel a pending transaction. */
  async cancel(userId?: string): Promise<Result<TransactionState>> {
    if (this.state.status !== 'pending') {
      return err({
        code: 'INVALID_TRANSITION',
        message: `Cannot cancel transaction in state ${this.state.status}`,
        statusCode: 409,
      });
    }

    await this.commit('TransactionCancelled', {}, { userId });
    return ok(this.state);
  }

  /** Get current state snapshot. */
  getState(): TransactionState {
    return { ...this.state };
  }
}
