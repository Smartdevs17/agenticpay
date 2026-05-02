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

export interface EventMetadata {
  correlationId?: string;
  causationId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface StoredEvent<T = unknown> extends DomainEvent<T> {
  sequenceNumber: number;
  streamId: string;
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

export type EventHandler<T = unknown> = (event: StoredEvent<T>) => void | Promise<void>;

export interface PaymentCreatedPayload {
  from: string;
  to: string;
  amount: number;
  asset: string;
  trigger: { type: string; executeAt?: string };
}

export interface ProjectFundedPayload {
  projectId: string;
  client: string;
  amount: number;
}

export interface VerificationPayload {
  projectId: string;
  repositoryUrl: string;
  score?: number;
  summary?: string;
}

export interface ReceiptMintedPayload {
  tokenId: string;
  paymentId: string;
  sender: string;
  recipient: string;
  amount: number;
  asset: string;
}
