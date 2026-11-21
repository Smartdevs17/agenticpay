/**
 * aggregate.ts — Issue #946
 *
 * Aggregate root base class for event sourcing.
 *
 * Aggregates encapsulate state and business invariants. State changes are
 * expressed as domain events, which are appended to the event store. The
 * aggregate is rehydrated by replaying its events.
 */

import type { StoredEvent, CommandResult } from './types.js';
import { getEventStore } from './event-store.js';

/** The shape of aggregate state; subclasses define their own. */
export interface AggregateState {
  [key: string]: unknown;
}

/**
 * Base class for event-sourced aggregates.
 *
 * Subclasses:
 * 1. Define an initial state via `initialState()`.
 * 2. Implement `apply(event)` to mutate state from a stored event (pure).
 * 3. Expose command methods that validate input, emit events, and call
 *    `this.commit(eventType, payload)` to append to the store.
 *
 * The aggregate is NOT persisted directly — only its events are. State is
 * reconstructed by replaying events through `apply()`.
 */
export abstract class AggregateRoot<T extends AggregateState> {
  protected abstract readonly aggregateType: string;
  protected abstract readonly id: string;
  protected state: T;
  protected version = 0;
  private uncommitted: StoredEvent[] = [];

  constructor(initialState: T) {
    this.state = initialState;
  }

  /** Rehydrate the aggregate from its historical events. */
  async load(): Promise<void> {
    const store = getEventStore();
    const events = await store.getStream(this.id);
    this.version = 0;
    for (const event of events) {
      this.apply(event);
      this.version = event.version;
    }
    this.uncommitted = [];
  }

  /** Pure state transition: apply one historical event to current state. */
  protected abstract apply(event: StoredEvent): void;

  /** Emit a new event: validate, append to store, update local state. */
  protected async commit<P>(
    eventType: string,
    payload: P,
    options: {
      userId?: string;
      correlationId?: string;
      causationId?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<CommandResult> {
    const store = getEventStore();
    const result = await store.append(this.aggregateType, this.id, eventType, payload, {
      expectedVersion: this.version,
      userId: options.userId,
      correlationId: options.correlationId,
      causationId: options.causationId,
      metadata: options.metadata,
    });

    if (!result.ok) return result;

    const event = result.value;
    this.apply(event);
    this.version = event.version;
    this.uncommitted.push(event);
    return ok(undefined);
  }

  /** Get the uncommitted events since last save (useful for projections). */
  getUncommitted(): StoredEvent[] {
    return [...this.uncommitted];
  }

  /** Mark uncommitted events as committed (called after projection dispatches). */
  markCommitted(): void {
    this.uncommitted = [];
  }

  /** Current aggregate version. */
  getVersion(): number {
    return this.version;
  }

  /** Current aggregate id. */
  getId(): string {
    return this.id;
  }
}
