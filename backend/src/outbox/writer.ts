import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import type { EnqueueOutboxEventInput, OutboxPrismaClient, OutboxStoredEvent } from './types.js';

function toStoredEvent<T>(input: EnqueueOutboxEventInput<T>): OutboxStoredEvent<T> {
  const id = randomUUID();
  const now = new Date().toISOString();
  return {
    id,
    type: input.eventType,
    aggregateId: input.aggregateId,
    aggregateType: input.aggregateType,
    version: input.version ?? 1,
    payload: input.payload,
    metadata: input.metadata ?? {},
    occurredAt: now,
    sequenceNumber: input.sequenceNumber ?? Date.now(),
    streamId: `${input.aggregateType}:${input.aggregateId}`,
  };
}

export async function enqueueOutboxEvent<T>(
  tx: OutboxPrismaClient,
  input: EnqueueOutboxEventInput<T>
) {
  const event = toStoredEvent(input);
  return enqueueStoredOutboxEvent(tx, event);
}

export async function enqueueStoredOutboxEvent(
  tx: OutboxPrismaClient,
  event: OutboxStoredEvent
) {
  return tx.outboxEvent.create({
    data: {
      id: event.id,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.type,
      payload: { event },
      status: 'pending',
    },
  });
}

export async function enqueueOutboxEventOutsideTransaction<T>(
  input: EnqueueOutboxEventInput<T>
) {
  return enqueueOutboxEvent(prisma as unknown as OutboxPrismaClient, input);
}

export async function enqueueStoredOutboxEventOutsideTransaction(event: OutboxStoredEvent) {
  return enqueueStoredOutboxEvent(prisma as unknown as OutboxPrismaClient, event);
}

export function getStoredEventFromOutbox(record: { payload: unknown }): OutboxStoredEvent {
  const payload = record.payload as { event?: OutboxStoredEvent };
  if (!payload.event) {
    throw new Error('Outbox payload is missing event envelope');
  }
  return payload.event;
}
