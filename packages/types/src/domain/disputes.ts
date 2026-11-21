import type { CurrencyCode, ISO8601, UUID } from './primitives.js';

export type DisputeStatus =
  | 'pending'
  | 'awaiting_response'
  | 'under_review'
  | 'resolved'
  | 'escalated'
  | 'dismissed';

export type DisputeReason =
  | 'service_not_delivered'
  | 'partial_delivery'
  | 'quality_issue'
  | 'unauthorized_charge'
  | 'duplicate_charge'
  | 'other';

export type ResolutionOutcome =
  | 'full_refund'
  | 'partial_refund'
  | 'release_to_payee'
  | 'dismissed'
  | 'pending';

export interface Evidence {
  id: UUID;
  disputeId: UUID;
  submittedBy: UUID;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  description: string;
  timestamp: ISO8601;
  hash: string;
}

export interface DisputeMessage {
  id: UUID;
  disputeId: UUID;
  senderId: UUID | 'system';
  senderRole: 'payer' | 'payee' | 'arbitrator' | 'system';
  content: string;
  timestamp: ISO8601;
}

export interface Dispute {
  id: UUID;
  paymentId?: UUID;
  projectId?: UUID;
  invoiceId?: UUID;
  filedBy?: UUID;
  raisedBy?: UUID;
  respondentId?: UUID;
  arbitratorId?: UUID;
  status: DisputeStatus;
  reason: DisputeReason;
  amount?: number;
  currency?: CurrencyCode;
  description?: string;
  evidence?: Evidence[];
  messages?: DisputeMessage[];
  resolution?: ResolutionOutcome;
  outcome?: ResolutionOutcome | null;
  resolutionNote?: string;
  refundAmount?: number;
  responseDeadline?: ISO8601;
  escalationDeadline?: ISO8601;
  createdAt: ISO8601;
  updatedAt: ISO8601;
  resolvedAt?: ISO8601;
}

export interface CreateDisputeInput {
  paymentId: UUID;
  respondentId: UUID;
  reason: DisputeReason;
  amount: number;
  currency: CurrencyCode;
  description: string;
  projectId?: UUID;
  invoiceId?: UUID;
}
