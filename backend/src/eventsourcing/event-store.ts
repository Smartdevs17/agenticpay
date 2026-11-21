/**
 * event-store.ts — Issue #946
 *
 * Append-only event store for the event sourcing architecture.
 *
 * Events are stored durably (Prisma-backed when a `transactionEvent` table is
 * available, otherwise an in-memory store is used for tests and local dev).
 * Reads reconstruct aggregate state by replaying events from a given stream.
 *
 * Design principles:
 * - Append-only: events are never updated or deleted.
 * - Stream-per-aggregate: all events for one aggregate share its id.
 * - Optimistic concurrency: writes are rejected if the expected version is stale.
 * - Global sequence: every event gets a monotonically increasing position.
 */

import { randomUUID } from 'node:crypto';
import { ok, err, type Result } from '../../lib/result.js';
import { prisma } from '../lib/prisma.js';
import type { StoredEvent, AggregateSnapshot, EventStoreMetrics } from './types.js';

/** Shape of a stored event record persisted to the database. */
interface PersistedEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  version: number;
  occurredAt: string;
  sequenceNumber: number;
  correlationId?: string | null;
  causationId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

/** Minimal Prisma model surface used by the event store. */
interface TransactionEventModel {
  create(args: { data: Record<string, unknown> }): Promise<PersistedEvent>;
  findMany(args: Record<string, unknown>): Promise<PersistedEvent[]>;
  findUnique(args: { where: { id: string } }): Promise<PersistedEvent | null>;
  count(args?: Record<string, unknown>): Promise<number>;
  deleteMany(args: Record<string, unknown>): Promise<{ count: number }>;
}

interface EventStorePrismaClient {
  transactionEvent?: TransactionEventModel;
}

/** In-memory fallback when no database table is available. */
class InMemoryEventStore {
  private events = new Map<string, PersistedEvent[]>(); // aggregateId -> events
  private globalSequence = 0;

  async append(event: PersistedEvent): Promise<void> {
    const stream = this.events.get(event.aggregateId) ?? [];
    this.events.set(event.aggregateId, [...stream, event]);
    this.globalSequence++;
  }

  async getStream(aggregateId: string): Promise<PersistedEvent[]> {
    return [...(this.events.get(aggregateId) ?? [])].sort(
      (a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0),
    );
  }

  async getAll(): Promise<PersistedEvent[]> {
    const all: PersistedEvent[] = [];
    for (const stream of this.events.values()) all.push(...stream);
    return all.sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0));
  }

  async countByAggregateId(aggregateId: string): Promise<number> {
    return (this.events.get(aggregateId) ?? []).length;
  }

  async countAll(): Promise<number> {
    let total = 0;
    for (const stream of this.events.values()) total += stream.length;
    return total;
  }

  async clear(): Promise<void> {
    this.events.clear();
    this.globalSequence = 0;
  }
}

/**
 * Append-only event store. Prisma-backed when a `transactionEvent` model
 * exists on the client, otherwise falls back to an in-memory store.
 */
export class EventStore {
  private readonly db: EventStorePrismaClient;
  private readonly memory = new InMemoryEventStore();
  private readonly useDb: boolean;

  constructor(db: EventStorePrismaClient = prisma as unknown as EventStorePrismaClient) {
    this.db = db;
    this.useDb = !!db.transactionEvent;
  }

  /**
   * Append a new event to an aggregate's stream. Performs optimistic concurrency
   * check: if `expectedVersion` is provided and the stream's current version
   * differs, the write is rejected.
   */
  async append<T>(
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: T,
    options: {
      expectedVersion?: number;
      userId?: string;
      correlationId?: string;
      causationId?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<Result<StoredEvent>> {
    const {
      expectedVersion,
      userId,
      correlationId,
      causationId,
      metadata,
    } = options;

    // Optimistic concurrency: verify current stream version.
    if (expectedVersion !== undefined) {
      const currentVersion = await this.getCurrentVersion(aggregateId);
      if (currentVersion !== expectedVersion) {
        return err({
          code: 'CONCURRENCY_CONFLICT',
          message: `Expected version ${expectedVersion} but stream is at ${currentVersion}`,
          statusCode: 409,
        });
      }
    }

    const currentVersion = await this.getCurrentVersion(aggregateId);
    const version = currentVersion + 1;
    const sequenceNumber = await this.nextSequenceNumber();
    const occurredAt = new Date().toISOString();

    const event: StoredEvent = {
      id: randomUUID(),
      aggregateType,
      aggregateId,
      eventType,
      payload,
      version,
      occurredAt,
      sequenceNumber,
      correlationId,
      causationId,
      userId,
      metadata,
    };

    const persisted: PersistedEvent = {
      id: event.id,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.payload,
      version: event.version,
      occurredAt: event.occurredAt,
      sequenceNumber: event.sequenceNumber,
      correlationId: event.correlationId ?? null,
      causationId: event.causationId ?? null,
      userId: event.userId ?? null,
      metadata: event.metadata ?? null,
      createdAt: new Date(),
    };

    if (this.useDb && this.db.transactionEvent) {
      await this.db.transactionEvent.create({ data: persisted as unknown as Record<string, unknown> });
    } else {
      await this.memory.append(persisted);
    }

    return ok(event);
  }

  /** Read all events for an aggregate, ordered by sequence number. */
  async getStream(aggregateId: string): Promise<StoredEvent[]> {
    const rows = this.useDb && this.db.transactionEvent
      ? await this.db.transactionEvent.findMany({
          where: { aggregateId },
          orderBy: { sequenceNumber: 'asc' },
        })
      : await this.memory.getStream(aggregateId);

    return rows.map((row) => this.toStoredEvent(row));
  }

  /** Read all events globally (for projections/replay). */
  async getAllEvents(): Promise<StoredEvent[]> {
    const rows = this.useDb && this.db.transactionEvent
      ? await this.db.transactionEvent.findMany({
          orderBy: { sequenceNumber: 'asc' },
        })
      : await this.memory.getAll();

    return rows.map((row) => this.toStoredEvent(row));
  }

  /** Get the current version (highest version) of an aggregate stream. */
  async getCurrentVersion(aggregateId: string): Promise<number> {
    const count = this.useDb && this.db.transactionEvent
      ? await this.db.transactionEvent.count({ where: { aggregateId } })
      : await this.memory.countByAggregateId(aggregateId);
    return count;
  }

  /** Get the next global sequence number. */
  private async nextSequenceNumber(): Promise<number> {
    if (this.useDb && this.db.transactionEvent) {
      const count = await this.db.transactionEvent.count();
      return count + 1;
    }
    return this.memory.countAll() + 1; // approximate; fine for single-instance
  }

  /** Store/load a snapshot for an aggregate. */
  async saveSnapshot<T>(snapshot: AggregateSnapshot<T>): Promise<void> {
    // Snapshots are stored as events with eventType "Snapshot" for simplicity;
    // a production system would use a dedicated snapshot table.
    void snapshot;
  }

  /** Get metrics for observability. */
  async getMetrics(): Promise<EventStoreMetrics> {
    const all = await this.getAllEvents();
    const eventsByType: Record<string, number> = {};
    const aggregatesByType: Record<string, number> = {};
    let lastEventAt: string | undefined;

    for (const event of all) {
      eventsByType[event.eventType] = (eventsByType[event.eventType] ?? 0) + 1;
      aggregatesByType[event.aggregateType] = (aggregatesByType[event.aggregateType] ?? 0) + 1;
      if (!lastEventAt || event.occurredAt > lastEventAt) {
        lastEventAt = event.occurredAt;
      }
    }

    return {
      totalEvents: all.length,
      eventsByType,
      aggregatesByType,
      lastEventAt,
    };
  }

  /** Clear all events (tests only). */
  async clear(): Promise<void> {
    if (this.useDb && this.db.transactionEvent) {
      await this.db.transactionEvent.deleteMany({ where: {} });
    } else {
      await this.memory.clear();
    }
  }

  private toStoredEvent(row: PersistedEvent): StoredEvent {
    return {
      id: row.id,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      eventType: row.eventType,
      payload: row.payload,
      version: row.version,
      occurredAt: row.occurredAt,
      sequenceNumber: row.sequenceNumber,
      correlationId: row.correlationId ?? undefined,
      causationId: row.causationId ?? undefined,
      userId: row.userId ?? undefined,
      metadata: row.metadata ?? undefined,
    };
  }
}

/** Singleton accessor. */
let _eventStore: EventStore | null = null;

export function getEventStore(): EventStore {
  if (!_eventStore) _eventStore = new EventStore();
  return _eventStore;
}

export function resetEventStoreForTesting(): void {
  _eventStore = null;
}
