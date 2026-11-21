/**
 * projection.ts — Issue #946
 *
 * Projection base class for building read models from event streams.
 *
 * Projections subscribe to event types and maintain a denormalized read model.
 * They are eventually consistent: events are applied asynchronously after the
 * aggregate commits them.
 */

import type { StoredEvent, EventHandler, ProjectionSubscription } from './types.js';
import { getEventStore } from './event-store.js';

/** Base class for projections. Subclasses implement `subscribe()` and event
 *  handler methods keyed by event type. */
export abstract class Projection {
  protected abstract readonly name: string;
  protected abstract readonly eventTypes: string[];

  /** Return the subscription descriptor used by the projection manager. */
  getSubscription(): ProjectionSubscription {
    return {
      projectionName: this.name,
      eventTypes: this.eventTypes,
      handler: async (event: StoredEvent) => {
        const handlerName = `on${event.eventType.charAt(0).toUpperCase()}${event.eventType.slice(1)}`;
        const handler = (this as unknown as Record<string, EventHandler>)[handlerName];
        if (typeof handler === 'function') {
          await handler.call(this, event);
        }
      },
    };
  }

  /** Projected read model accessor (subclasses override). */
  abstract getReadModel(aggregateId: string): unknown;
}

/** Manages projections and replays events into them. */
export class ProjectionManager {
  private readonly projections = new Map<string, Projection>();
  private readonly store = getEventStore();
  private running = false;

  register(projection: Projection): void {
    this.projections.set(projection.name, projection);
  }

  /** Replay all historical events into every registered projection. */
  async replay(): Promise<void> {
    const events = await this.store.getAllEvents();
    for (const event of events) {
      for (const projection of this.projections.values()) {
        const sub = projection.getSubscription();
        if (sub.eventTypes.includes(event.eventType)) {
          await sub.handler(event);
        }
      }
    }
  }

  /** Project a single new event into all interested projections. */
  async project(event: StoredEvent): Promise<void> {
    for (const projection of this.projections.values()) {
      const sub = projection.getSubscription();
      if (sub.eventTypes.includes(event.eventType)) {
        await sub.handler(event);
      }
    }
  }

  getProjectionNames(): string[] {
    return Array.from(this.projections.keys());
  }
}

/** Singleton projection manager. */
let _manager: ProjectionManager | null = null;

export function getProjectionManager(): ProjectionManager {
  if (!_manager) _manager = new ProjectionManager();
  return _manager;
}

export function resetProjectionManagerForTesting(): void {
  _manager = null;
}
