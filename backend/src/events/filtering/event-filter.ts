import type { StoredEvent, DomainEventType } from '../event-types.js';

export interface EventFilterOptions {
  eventTypes?: DomainEventType[];
  aggregateIds?: string[];
  aggregateTypes?: string[];
  fromVersion?: number;
  toVersion?: number;
  fromSequence?: number;
  toSequence?: number;
  fromTime?: Date;
  toTime?: Date;
  metadata?: Record<string, unknown>;
  customFilter?: (event: StoredEvent) => boolean;
}

export interface SubscriptionOptions {
  filter?: EventFilterOptions;
  once?: boolean;
  priority?: number;
  errorHandler?: (error: Error, event: StoredEvent) => void;
}

export type EventHandler<T = unknown> = (event: StoredEvent<T>) => void | Promise<void>;

export interface Subscription {
  id: string;
  filter?: EventFilterOptions;
  handler: EventHandler;
  once: boolean;
  priority: number;
  errorHandler?: (error: Error, event: StoredEvent) => void;
  createdAt: Date;
}

export class EventFilter {
  private filter: EventFilterOptions;

  constructor(filter: EventFilterOptions = {}) {
    this.filter = filter;
  }

  matches(event: StoredEvent): boolean {
    // Check event types
    if (this.filter.eventTypes && this.filter.eventTypes.length > 0) {
      if (!this.filter.eventTypes.includes(event.type as DomainEventType)) {
        return false;
      }
    }

    // Check aggregate IDs
    if (this.filter.aggregateIds && this.filter.aggregateIds.length > 0) {
      if (!this.filter.aggregateIds.includes(event.aggregateId)) {
        return false;
      }
    }

    // Check aggregate types
    if (this.filter.aggregateTypes && this.filter.aggregateTypes.length > 0) {
      if (!this.filter.aggregateTypes.includes(event.aggregateType)) {
        return false;
      }
    }

    // Check version range
    if (this.filter.fromVersion !== undefined && event.version < this.filter.fromVersion) {
      return false;
    }

    if (this.filter.toVersion !== undefined && event.version > this.filter.toVersion) {
      return false;
    }

    // Check sequence range
    if (this.filter.fromSequence !== undefined && event.sequenceNumber < this.filter.fromSequence) {
      return false;
    }

    if (this.filter.toSequence !== undefined && event.sequenceNumber > this.filter.toSequence) {
      return false;
    }

    // Check time range
    if (this.filter.fromTime) {
      const eventTime = new Date(event.occurredAt);
      if (eventTime < this.filter.fromTime) {
        return false;
      }
    }

    if (this.filter.toTime) {
      const eventTime = new Date(event.occurredAt);
      if (eventTime > this.filter.toTime) {
        return false;
      }
    }

    // Check metadata
    if (this.filter.metadata) {
      for (const [key, value] of Object.entries(this.filter.metadata)) {
        if ((event.metadata as any)[key] !== value) {
          return false;
        }
      }
    }

    // Check custom filter
    if (this.filter.customFilter && !this.filter.customFilter(event)) {
      return false;
    }

    return true;
  }

  static builder(): EventFilterBuilder {
    return new EventFilterBuilder();
  }
}

export class EventFilterBuilder {
  private filter: EventFilterOptions = {};

  eventTypes(...types: DomainEventType[]): EventFilterBuilder {
    this.filter.eventTypes = types;
    return this;
  }

  aggregateIds(...ids: string[]): EventFilterBuilder {
    this.filter.aggregateIds = ids;
    return this;
  }

  aggregateTypes(...types: string[]): EventFilterBuilder {
    this.filter.aggregateTypes = types;
    return this;
  }

  fromVersion(version: number): EventFilterBuilder {
    this.filter.fromVersion = version;
    return this;
  }

  toVersion(version: number): EventFilterBuilder {
    this.filter.toVersion = version;
    return this;
  }

  fromSequence(sequence: number): EventFilterBuilder {
    this.filter.fromSequence = sequence;
    return this;
  }

  toSequence(sequence: number): EventFilterBuilder {
    this.filter.toSequence = sequence;
    return this;
  }

  fromTime(time: Date): EventFilterBuilder {
    this.filter.fromTime = time;
    return this;
  }

  toTime(time: Date): EventFilterBuilder {
    this.filter.toTime = time;
    return this;
  }

  metadata(metadata: Record<string, unknown>): EventFilterBuilder {
    this.filter.metadata = metadata;
    return this;
  }

  customFilter(filter: (event: StoredEvent) => boolean): EventFilterBuilder {
    this.filter.customFilter = filter;
    return this;
  }

  build(): EventFilterOptions {
    return this.filter;
  }
}

export class SubscriptionManager {
  private subscriptions: Map<string, Subscription> = new Map();
  private nextId = 1;

  subscribe<T = unknown>(
    handler: EventHandler<T>,
    options: SubscriptionOptions = {}
  ): () => void {
    const id = `sub-${this.nextId++}`;
    const subscription: Subscription = {
      id,
      filter: options.filter,
      handler: handler as EventHandler,
      once: options.once ?? false,
      priority: options.priority ?? 0,
      errorHandler: options.errorHandler,
      createdAt: new Date(),
    };

    this.subscriptions.set(id, subscription);

    // Return unsubscribe function
    return () => this.unsubscribe(id);
  }

  unsubscribe(id: string): void {
    this.subscriptions.delete(id);
  }

  unsubscribeAll(): void {
    this.subscriptions.clear();
  }

  async publish(event: StoredEvent): Promise<void> {
    // Get matching subscriptions
    const matchingSubs = this.getMatchingSubscriptions(event);

    // Sort by priority (higher priority first)
    matchingSubs.sort((a, b) => b.priority - a.priority);

    // Execute handlers
    for (const sub of matchingSubs) {
      try {
        await sub.handler(event);

        // Remove one-time subscriptions
        if (sub.once) {
          this.subscriptions.delete(sub.id);
        }
      } catch (error) {
        if (sub.errorHandler) {
          sub.errorHandler(error as Error, event);
        } else {
          console.error(`[SubscriptionManager] Handler ${sub.id} failed:`, error);
        }
      }
    }
  }

  private getMatchingSubscriptions(event: StoredEvent): Subscription[] {
    const matching: Subscription[] = [];

    for (const sub of this.subscriptions.values()) {
      if (!sub.filter) {
        matching.push(sub);
        continue;
      }

      const filter = new EventFilter(sub.filter);
      if (filter.matches(event)) {
        matching.push(sub);
      }
    }

    return matching;
  }

  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  getSubscriptionsByEventType(eventType: DomainEventType): Subscription[] {
    const matching: Subscription[] = [];

    for (const sub of this.subscriptions.values()) {
      if (sub.filter?.eventTypes?.includes(eventType)) {
        matching.push(sub);
      }
    }

    return matching;
  }

  getSubscriptionsByAggregate(aggregateId: string): Subscription[] {
    const matching: Subscription[] = [];

    for (const sub of this.subscriptions.values()) {
      if (sub.filter?.aggregateIds?.includes(aggregateId)) {
        matching.push(sub);
      }
    }

    return matching;
  }
}
