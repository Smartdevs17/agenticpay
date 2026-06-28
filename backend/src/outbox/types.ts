import type { DomainEventType, EventMetadata, StoredEvent } from '@agenticpay/types/events';

export type OutboxEventStatus = 'pending' | 'publishing' | 'published' | 'dead_letter';

export interface EnqueueOutboxEventInput<T = unknown> {
  aggregateType: string;
  aggregateId: string;
  eventType: DomainEventType;
  payload: T;
  metadata?: EventMetadata;
  version?: number;
  sequenceNumber?: number;
}

export interface OutboxEventRecord {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  status: OutboxEventStatus;
  attempts: number;
  lastError: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutboxModel {
  create(args: { data: Record<string, unknown> }): Promise<OutboxEventRecord>;
  findMany(args: Record<string, unknown>): Promise<OutboxEventRecord[]>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<OutboxEventRecord>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  count(args?: Record<string, unknown>): Promise<number>;
  deleteMany(args: Record<string, unknown>): Promise<{ count: number }>;
}

export interface OutboxPrismaClient {
  outboxEvent: OutboxModel;
}

export interface OutboxPublisherOptions {
  pollIntervalMs?: number;
  batchSize?: number;
  maxAttempts?: number;
  cleanupOlderThanDays?: number;
  useBullMQ?: boolean;
}

export type OutboxStoredEvent<T = unknown> = StoredEvent<T>;
