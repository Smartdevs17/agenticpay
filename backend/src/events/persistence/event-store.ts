import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type {
  DomainEvent,
  DomainEventType,
  EventMetadata,
  StoredEvent,
} from '../event-types.js';

export interface AppendOptions {
  expectedVersion?: number;
}

export interface TemporalQuery {
  aggregateId: string;
  aggregateType: string;
  asOf: string;
}

export interface EventStream {
  streamId: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  events: StoredEvent[];
  createdAt: string;
  updatedAt: string;
}

export class PersistentEventStore {
  constructor(private readonly prisma: PrismaClient) {}

  private streamKey(aggregateType: string, aggregateId: string): string {
    return `${aggregateType}:${aggregateId}`;
  }

  async appendEvent<T>(
    aggregateType: string,
    aggregateId: string,
    type: DomainEventType,
    payload: T,
    metadata: EventMetadata = {},
    opts: AppendOptions = {}
  ): Promise<StoredEvent<T>> {
    const key = this.streamKey(aggregateType, aggregateId);
    const now = new Date();

    // Check optimistic concurrency
    if (opts.expectedVersion !== undefined) {
      const latestEvent = await this.prisma.eventStore.findFirst({
        where: { streamId: key },
        orderBy: { version: 'desc' },
      });

      if (latestEvent && latestEvent.version !== opts.expectedVersion) {
        throw new Error(
          `Optimistic concurrency conflict: expected version ${opts.expectedVersion}, got ${latestEvent.version}`
        );
      }
    }

    // Get next version
    const latestEvent = await this.prisma.eventStore.findFirst({
      where: { streamId: key },
      orderBy: { version: 'desc' },
    });

    const nextVersion = latestEvent ? latestEvent.version + 1 : 1;

    // Get next sequence number
    const maxSequence = await this.prisma.eventStore.aggregate({
      _max: { sequenceNumber: true },
    });

    const sequenceNumber = (maxSequence._max.sequenceNumber ?? 0n) + 1n;

    const event: DomainEvent<T> = {
      id: randomUUID(),
      type,
      aggregateId,
      aggregateType,
      version: nextVersion,
      payload,
      metadata,
      occurredAt: now.toISOString(),
    };

    const stored: StoredEvent<T> = { ...event, sequenceNumber: Number(sequenceNumber), streamId: key };

    // Persist to database
    await this.prisma.eventStore.create({
      data: {
        id: stored.id,
        streamId: stored.streamId,
        eventType: stored.type,
        aggregateType: stored.aggregateType,
        aggregateId: stored.aggregateId,
        version: stored.version,
        payload: stored.payload as any,
        metadata: stored.metadata as any,
        occurredAt: new Date(stored.occurredAt),
        sequenceNumber: BigInt(stored.sequenceNumber),
      },
    });

    return stored;
  }

  async loadStream(aggregateType: string, aggregateId: string): Promise<EventStream | null> {
    const key = this.streamKey(aggregateType, aggregateId);
    const events = await this.prisma.eventStore.findMany({
      where: { streamId: key },
      orderBy: { version: 'asc' },
    });

    if (events.length === 0) {
      return null;
    }

    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];

    return {
      streamId: key,
      aggregateId,
      aggregateType,
      version: lastEvent.version,
      events: events.map((e: any) => ({
        id: e.id,
        type: e.eventType as DomainEventType,
        aggregateId: e.aggregateId,
        aggregateType: e.aggregateType,
        version: e.version,
        payload: e.payload,
        metadata: e.metadata as EventMetadata,
        occurredAt: e.occurredAt.toISOString(),
        sequenceNumber: Number(e.sequenceNumber),
        streamId: e.streamId,
      })),
      createdAt: firstEvent.createdAt.toISOString(),
      updatedAt: lastEvent.createdAt.toISOString(),
    };
  }

  async loadEvents(
    aggregateType: string,
    aggregateId: string,
    fromVersion = 0
  ): Promise<StoredEvent[]> {
    const key = this.streamKey(aggregateType, aggregateId);
    const events = await this.prisma.eventStore.findMany({
      where: {
        streamId: key,
        version: { gt: fromVersion },
      },
      orderBy: { version: 'asc' },
    });

    return events.map((e: any) => ({
      id: e.id,
      type: e.eventType as DomainEventType,
      aggregateId: e.aggregateId,
      aggregateType: e.aggregateType,
      version: e.version,
      payload: e.payload,
      metadata: e.metadata as EventMetadata,
      occurredAt: e.occurredAt.toISOString(),
      sequenceNumber: Number(e.sequenceNumber),
      streamId: e.streamId,
    }));
  }

  async loadSnapshot(query: TemporalQuery): Promise<StoredEvent[]> {
    const key = this.streamKey(query.aggregateType, query.aggregateId);
    const asOfDate = new Date(query.asOf);

    const events = await this.prisma.eventStore.findMany({
      where: {
        streamId: key,
        occurredAt: { lte: asOfDate },
      },
      orderBy: { version: 'asc' },
    });

    return events.map((e: any) => ({
      id: e.id,
      type: e.eventType as DomainEventType,
      aggregateId: e.aggregateId,
      aggregateType: e.aggregateType,
      version: e.version,
      payload: e.payload,
      metadata: e.metadata as EventMetadata,
      occurredAt: e.occurredAt.toISOString(),
      sequenceNumber: Number(e.sequenceNumber),
      streamId: e.streamId,
    }));
  }

  async getAllEvents(fromSequence = 0): Promise<StoredEvent[]> {
    const events = await this.prisma.eventStore.findMany({
      where: {
        sequenceNumber: { gt: BigInt(fromSequence) },
      },
      orderBy: { sequenceNumber: 'asc' },
    });

    return events.map((e: any) => ({
      id: e.id,
      type: e.eventType as DomainEventType,
      aggregateId: e.aggregateId,
      aggregateType: e.aggregateType,
      version: e.version,
      payload: e.payload,
      metadata: e.metadata as EventMetadata,
      occurredAt: e.occurredAt.toISOString(),
      sequenceNumber: Number(e.sequenceNumber),
      streamId: e.streamId,
    }));
  }

  async getEventsByType(type: DomainEventType): Promise<StoredEvent[]> {
    const events = await this.prisma.eventStore.findMany({
      where: { eventType: type },
      orderBy: { sequenceNumber: 'asc' },
    });

    return events.map((e: any) => ({
      id: e.id,
      type: e.eventType as DomainEventType,
      aggregateId: e.aggregateId,
      aggregateType: e.aggregateType,
      version: e.version,
      payload: e.payload,
      metadata: e.metadata as EventMetadata,
      occurredAt: e.occurredAt.toISOString(),
      sequenceNumber: Number(e.sequenceNumber),
      streamId: e.streamId,
    }));
  }

  async getAllStreams(): Promise<EventStream[]> {
    const streamIds = await this.prisma.eventStore.findMany({
      select: { streamId: true },
      distinct: ['streamId'],
    });

    const streams: EventStream[] = [];

    for (const { streamId } of streamIds) {
      const [aggregateType, aggregateId] = streamId.split(':');
      const stream = await this.loadStream(aggregateType, aggregateId);
      if (stream) {
        streams.push(stream);
      }
    }

    return streams;
  }

  async getEventStats() {
    const totalEvents = await this.prisma.eventStore.count();
    const totalStreams = await this.prisma.eventStore.groupBy({
      by: ['streamId'],
    });

    const typeCounts = await this.prisma.eventStore.groupBy({
      by: ['eventType'],
      _count: true,
    });

    const typeCountsMap: Record<string, number> = {};
    for (const { eventType, _count } of typeCounts) {
      typeCountsMap[eventType] = _count;
    }

    return {
      totalEvents,
      totalStreams: totalStreams.length,
      typeCounts: typeCountsMap,
    };
  }

  async createSnapshot(aggregateType: string, aggregateId: string, state: unknown): Promise<void> {
    const key = this.streamKey(aggregateType, aggregateId);
    const stream = await this.loadStream(aggregateType, aggregateId);

    if (!stream) {
      throw new Error(`Stream not found: ${key}`);
    }

    await this.prisma.eventSnapshot.upsert({
      where: { streamId: key },
      update: {
        version: stream.version,
        state: state as any,
        createdAt: new Date(),
      },
      create: {
        streamId: key,
        aggregateType,
        aggregateId,
        version: stream.version,
        state: state as any,
      },
    });
  }

  async getSnapshot(aggregateType: string, aggregateId: string): Promise<{ version: number; state: unknown } | null> {
    const key = this.streamKey(aggregateType, aggregateId);
    const snapshot = await this.prisma.eventSnapshot.findUnique({
      where: { streamId: key },
    });

    if (!snapshot) {
      return null;
    }

    return {
      version: snapshot.version,
      state: snapshot.state,
    };
  }
}
