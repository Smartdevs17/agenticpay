/**
 * Typed Event Bus with Domain Events
 * Provides strongly-typed publish/subscribe for domain events
 */

import type {
  DomainEventType,
  StoredEvent,
  EventHandler,
  EventMetadata,
  DomainEvent,
} from './event-types.js';
import { subscribe, subscribeAll, publish as rawPublish } from './event-bus.js';
import { eventSchemaRegistry } from './schemas/index.js';

// Domain event payload map for type safety
export interface DomainEventPayloadMap {
  'payment.created': { from: string; to: string; amount: number; asset: string; trigger?: { type: string; executeAt?: string } };
  'payment.executed': { paymentId: string; transactionHash: string; amount: number; asset: string; fee?: number };
  'payment.failed': { paymentId: string; reason: string; error: string; retryable: boolean; retryCount: number };
  'payment.cancelled': { paymentId: string; cancelledBy: string; cancelledAt: string; reason?: string };
  'project.created': { client: string; amount: number; freelancer?: string; repoUrl?: string };
  'project.funded': Record<string, unknown>;
  'project.work_submitted': { repoUrl?: string };
  'project.work_approved': Record<string, unknown>;
  'project.disputed': Record<string, unknown>;
  'project.cancelled': Record<string, unknown>;
  'project.completed': Record<string, unknown>;
  'verification.requested': { projectId: string; repositoryUrl: string };
  'verification.passed': { score?: number; summary?: string };
  'verification.failed': { score?: number; summary?: string };
  'invoice.generated': { invoiceId: string; paymentId: string; amount: number; currency: string };
  'receipt.minted': { tokenId: string; paymentId: string; sender: string; recipient: string; amount: number; asset: string };
  'receipt.transferred': { tokenId: string; from: string; to: string };
  'receipt.burned': { tokenId: string; burnedBy: string };
  'refund.requested': { refundId: string; paymentId: string; amount: number; reason: string };
  'refund.approved': { refundId: string; approvedBy: string };
  'refund.rejected': { refundId: string; rejectedBy: string; reason: string };
  'split.created': { splitId: string; totalAmount: number; asset: string };
  'split.executed': { splitId: string; transactionHash: string };
}

export type TypedDomainEventType = keyof DomainEventPayloadMap;

export type TypedEventHandler<K extends TypedDomainEventType> = (
  event: StoredEvent<DomainEventPayloadMap[K]>
) => void | Promise<void>;

export type TypedEventMetadata = EventMetadata;

/**
 * Typed Event Bus – wraps the raw event bus with compile-time payload checking
 */
export class TypedEventBus {
  subscribe<K extends TypedDomainEventType>(type: K, handler: TypedEventHandler<K>): () => void {
    return subscribe(type as DomainEventType, handler as EventHandler);
  }

  subscribeAll(handler: (event: StoredEvent) => void | Promise<void>): () => void {
    return subscribeAll(handler);
  }

  async publish<K extends TypedDomainEventType>(
    event: StoredEvent<DomainEventPayloadMap[K]>
  ): Promise<void> {
    // Validate against schema if available
    if (eventSchemaRegistry.hasSchema(event.type)) {
      const validation = eventSchemaRegistry.safeValidate(event.type, event.payload);
      if (!validation.success) {
        throw new Error(`Event schema validation failed for ${event.type}: ${validation.error.errors.map((e) => e.message).join(', ')}`);
      }
    }
    return rawPublish(event as StoredEvent);
  }

  // Helper to create and publish a domain event in one step
  async emit<K extends TypedDomainEventType>(
    type: K,
    aggregateType: string,
    aggregateId: string,
    payload: DomainEventPayloadMap[K],
    metadata: EventMetadata = {}
  ): Promise<StoredEvent<DomainEventPayloadMap[K]>> {
    const { appendEvent } = await import('./event-store.js');
    const stored = appendEvent(aggregateType, aggregateId, type as DomainEventType, payload, metadata);
    await this.publish(stored as StoredEvent<DomainEventPayloadMap[K]>);
    return stored as StoredEvent<DomainEventPayloadMap[K]>;
  }
}

export const typedEventBus = new TypedEventBus();

// Re-export core types
export type { DomainEvent, StoredEvent, EventHandler, EventMetadata, DomainEventType } from './event-types.js';
