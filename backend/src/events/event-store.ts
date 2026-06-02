import { randomUUID } from 'node:crypto';
import type {
  DomainEvent,
  DomainEventType,
  EventMetadata,
  EventStream,
  StoredEvent,
} from './event-types.js';

export interface AppendOptions {
  expectedVersion?: number;
}

export interface TemporalQuery {
  aggregateId: string;
  aggregateType: string;
  asOf: string;
}

const streams = new Map<string, EventStream>();
const globalSequence: StoredEvent[] = [];

function streamKey(aggregateType: string, aggregateId: string): string {
  return `${aggregateType}:${aggregateId}`;
}

export function appendEvent<T>(
  aggregateType: string,
  aggregateId: string,
  type: DomainEventType,
  payload: T,
  metadata: EventMetadata = {},
  opts: AppendOptions = {}
): StoredEvent<T> {
  const key = streamKey(aggregateType, aggregateId);
  const now = new Date().toISOString();

  let stream = streams.get(key);
  if (!stream) {
    stream = {
      streamId: key,
      aggregateId,
      aggregateType,
      version: 0,
      events: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  if (opts.expectedVersion !== undefined && stream.version !== opts.expectedVersion) {
    throw new Error(
      `Optimistic concurrency conflict: expected version ${opts.expectedVersion}, got ${stream.version}`
    );
  }

  const nextVersion = stream.version + 1;
  const sequenceNumber = globalSequence.length + 1;

  const event: DomainEvent<T> = {
    id: randomUUID(),
    type,
    aggregateId,
    aggregateType,
    version: nextVersion,
    payload,
    metadata,
    occurredAt: now,
  };

  const stored: StoredEvent<T> = { ...event, sequenceNumber, streamId: key };

  stream.events.push(stored as StoredEvent);
  stream.version = nextVersion;
  stream.updatedAt = now;

  streams.set(key, stream);
  globalSequence.push(stored as StoredEvent);

  return stored;
}

export function loadStream(aggregateType: string, aggregateId: string): EventStream | undefined {
  return streams.get(streamKey(aggregateType, aggregateId));
}

export function loadEvents(
  aggregateType: string,
  aggregateId: string,
  fromVersion = 0
): StoredEvent[] {
  const stream = streams.get(streamKey(aggregateType, aggregateId));
  if (!stream) return [];
  return stream.events.filter((e) => e.version > fromVersion);
}

export function loadSnapshot(query: TemporalQuery): StoredEvent[] {
  const stream = streams.get(streamKey(query.aggregateType, query.aggregateId));
  if (!stream) return [];
  const asOfMs = new Date(query.asOf).getTime();
  return stream.events.filter((e) => new Date(e.occurredAt).getTime() <= asOfMs);
}

export function getAllEvents(fromSequence = 0): StoredEvent[] {
  return globalSequence.filter((e) => e.sequenceNumber > fromSequence);
}

export function getEventsByType(type: DomainEventType): StoredEvent[] {
  return globalSequence.filter((e) => e.type === type);
}

export function getAllStreams(): EventStream[] {
  return Array.from(streams.values());
}

export function getEventStats() {
  const typeCounts: Record<string, number> = {};
  for (const e of globalSequence) {
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  }
  return {
    totalEvents: globalSequence.length,
    totalStreams: streams.size,
    typeCounts,
  };
}
