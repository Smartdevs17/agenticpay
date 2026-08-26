export type {
  DomainEvent,
  DomainEventType,
  EventHandler,
  EventMetadata,
  StoredEvent,
} from '@agenticpay/types/events';

import type { StoredEvent } from '@agenticpay/types/events';

export interface EventStream {
  streamId: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  events: StoredEvent[];
  createdAt: string;
  updatedAt: string;
}

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
