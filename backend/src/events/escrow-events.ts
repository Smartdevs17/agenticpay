/**
 * escrow-events.ts — Domain events for escrow state transitions (#1420)
 *
 * Provides typed definitions and exhaustive handling for all escrow state machine transitions.
 */

import { randomUUID } from 'node:crypto';
import type { DomainEventType, EventMetadata, EscrowStateTransitionPayload, StoredEvent } from './event-types.js';
import { publish } from './event-bus.js';
import { appendEvent } from './event-store.js';

export type EscrowTransition =
  | { type: 'create'; toStatus: 'pending'; amount: string; asset: string }
  | { type: 'fund'; fromStatus: 'pending'; toStatus: 'funded'; txHash: string }
  | { type: 'dispute'; fromStatus: 'funded'; toStatus: 'disputed'; raisedBy: string }
  | {
      type: 'resolve';
      fromStatus: 'disputed';
      toStatus: 'released' | 'refunded';
      releaseType: string;
      approvedBy: string[];
    }
  | { type: 'appeal'; fromStatus: 'disputed'; toStatus: 'disputed'; appealTarget: string }
  | { type: 'timeout_release'; fromStatus: 'disputed'; toStatus: 'released'; reason: string }
  | { type: 'expire'; fromStatus: 'pending' | 'funded'; toStatus: 'expired' };

/**
 * Maps an escrow transition to its canonical DomainEventType using an exhaustive match.
 */
export function mapEscrowTransitionToEventType(transition: EscrowTransition): DomainEventType {
  switch (transition.type) {
    case 'create':
      return 'escrow.created';
    case 'fund':
      return 'escrow.funded';
    case 'dispute':
      return 'escrow.disputed';
    case 'resolve':
      return transition.toStatus === 'refunded' ? 'escrow.refunded' : 'escrow.released';
    case 'appeal':
      return 'escrow.appealed';
    case 'timeout_release':
      return 'escrow.released';
    case 'expire':
      return 'escrow.expired';
    default: {
      const _exhaustive: never = transition;
      throw new Error(`Unhandled escrow transition: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export interface EscrowEntitySummary {
  id: string;
  projectId: string;
  status: string;
  amount: string;
  asset: string;
}

/**
 * Emits an explicit domain event for an escrow state machine transition.
 * Safely dispatches so handler failures never roll back the committed transition.
 */
export async function emitEscrowTransition(
  escrow: EscrowEntitySummary,
  transition: EscrowTransition,
  metadata: EventMetadata = {},
): Promise<StoredEvent<EscrowStateTransitionPayload>> {
  const eventType = mapEscrowTransitionToEventType(transition);
  const now = new Date().toISOString();

  let metadataPayload: EscrowStateTransitionPayload['metadata'] = undefined;
  switch (transition.type) {
    case 'create':
      metadataPayload = { amount: transition.amount, asset: transition.asset };
      break;
    case 'fund':
      metadataPayload = { txHash: transition.txHash };
      break;
    case 'dispute':
      metadataPayload = { raisedBy: transition.raisedBy };
      break;
    case 'resolve':
      metadataPayload = { releaseType: transition.releaseType, approvedBy: transition.approvedBy };
      break;
    case 'appeal':
      metadataPayload = { appealTarget: transition.appealTarget };
      break;
    case 'timeout_release':
      metadataPayload = { reason: transition.reason };
      break;
    case 'expire':
      metadataPayload = {};
      break;
  }

  const payload: EscrowStateTransitionPayload = {
    escrowId: escrow.id,
    projectId: escrow.projectId,
    fromStatus: 'fromStatus' in transition ? transition.fromStatus : 'none',
    toStatus: transition.toStatus,
    timestamp: Date.now(),
    metadata: metadataPayload,
  };

  const domainEvent = {
    id: randomUUID(),
    type: eventType,
    aggregateId: escrow.id,
    aggregateType: 'escrow',
    version: 1,
    payload,
    metadata,
    occurredAt: now,
  };

  // Persist to event store stream
  const storedEvent = appendEvent(`escrow-${escrow.id}`, domainEvent);

  // Publish to subscribers (EventBus protects against throwing handlers)
  try {
    await publish(storedEvent);
  } catch (publishError) {
    console.error(`[escrow-events] Failed publishing ${eventType} for ${escrow.id}:`, publishError);
  }

  return storedEvent;
}
