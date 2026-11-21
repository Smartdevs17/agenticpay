/**
 * types.ts — Issue #946
 *
 * Core types for the event sourcing architecture used by transactions.
 */

import type { Result } from '../../lib/result.js';

/** An immutable fact that something happened in the domain. */
export interface StoredEvent<T = unknown> {
  id: string;
  /** e.g. "transaction", "payment", "refund" */
  aggregateType: string;
  /** The aggregate instance id (e.g. a transaction id) */
  aggregateId: string;
  /** e.g. "TransactionCreated", "PaymentAuthorized", "TransactionCompleted" */
  eventType: string;
  /** The event payload (domain data). */
  payload: T;
  /** Monotonically increasing version within this aggregate stream. */
  version: number;
  /** When the event occurred. */
  occurredAt: string;
  /** Causal position in the global event log. */
  sequenceNumber: number;
  /** Optional correlation id linking related events (e.g. a payment to its transaction). */
  correlationId?: string;
  /** Optional causation id (the event that caused this one). */
  causationId?: string;
  /** User/system that initiated the event. */
  userId?: string;
  /** Additional metadata (tenant, trace id, etc.). */
  metadata?: Record<string, unknown>;
}

/** A snapshot of aggregate state used for faster rehydration. */
export interface AggregateSnapshot<T = unknown> {
  aggregateId: string;
  aggregateType: string;
  version: number;
  state: T;
  createdAt: string;
}

/** Command result returned by aggregate methods. */
export type CommandResult = Result<void>;

/** An event handler used by projections. */
export interface EventHandler<T = unknown> {
  (event: StoredEvent<T>): void | Promise<void>;
}

/** Projection subscription entry. */
export interface ProjectionSubscription {
  projectionName: string;
  eventTypes: string[];
  handler: EventHandler;
}

/** Metrics for the event store. */
export interface EventStoreMetrics {
  totalEvents: number;
  eventsByType: Record<string, number>;
  aggregatesByType: Record<string, number>;
  lastEventAt?: string;
}
