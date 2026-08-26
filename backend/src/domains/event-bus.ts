/**
 * Issue #489 — Domain event bus (Redis pub/sub)
 *
 * Lightweight async event bus. Domains publish events; other domains subscribe.
 * Uses Redis pub/sub so events work across multiple service instances.
 */

import type Redis from 'ioredis';
import type { DomainEvent } from './contracts.js';

type EventHandler<T = unknown> = (event: DomainEvent<T>) => Promise<void> | void;

export class DomainEventBus {
  private handlers = new Map<string, EventHandler[]>();
  private subscriber?: Redis;

  constructor(
    private readonly publisher: Redis,
    private readonly channel = 'domain-events',
  ) {}

  /** Attach a subscriber Redis client to receive events. */
  async subscribe(subscriber: Redis): Promise<void> {
    this.subscriber = subscriber;
    await subscriber.subscribe(this.channel);
    subscriber.on('message', (_ch: string, message: string) => {
      void this.dispatch(JSON.parse(message) as DomainEvent);
    });
  }

  /** Register a handler for a specific event type. */
  on<T>(eventType: string, handler: EventHandler<T>): void {
    const handlers = this.handlers.get(eventType) ?? [];
    handlers.push(handler as EventHandler);
    this.handlers.set(eventType, handlers);
  }

  /** Publish an event to all subscribers. */
  async publish<T>(event: DomainEvent<T>): Promise<void> {
    await this.publisher.publish(this.channel, JSON.stringify(event));
  }

  /** Dispatch locally (used by the subscriber callback). */
  private async dispatch(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.type) ?? [];
    await Promise.all(handlers.map((h) => h(event)));
  }

  async close(): Promise<void> {
    if (this.subscriber) await this.subscriber.unsubscribe(this.channel);
  }
}
