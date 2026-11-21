export type DomainEventType =
  | 'payment.created'
  | 'payment.executed'
  | 'payment.failed'
  | 'payment.cancelled'
  | 'project.created'
  | 'project.funded'
  | 'project.work_submitted'
  | 'project.work_approved'
  | 'project.disputed'
  | 'project.cancelled'
  | 'project.completed'
  | 'verification.requested'
  | 'verification.passed'
  | 'verification.failed'
  | 'invoice.generated'
  | 'receipt.minted'
  | 'receipt.transferred'
  | 'receipt.burned'
  | 'refund.requested'
  | 'refund.approved'
  | 'refund.rejected'
  | 'split.created'
  | 'split.executed';

export interface EventMetadata {
  correlationId?: string;
  causationId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface DomainEvent<T = unknown> {
  id: string;
  type: DomainEventType;
  aggregateId: string;
  aggregateType: string;
  version: number;
  payload: T;
  metadata: EventMetadata;
  occurredAt: string;
}

export interface StoredEvent<T = unknown> extends DomainEvent<T> {
  sequenceNumber: number;
  streamId: string;
}

export interface OutboxEventPayload<T = unknown> {
  event: StoredEvent<T>;
}

export type EventHandler<T = unknown> = (event: StoredEvent<T>) => void | Promise<void>;
