import type { CurrencyCode, ISO8601, UUID } from './primitives.js';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';

export interface Invoice {
  id: UUID;
  projectId: UUID;
  clientId?: UUID;
  freelancerId?: UUID;
  amount: number;
  currency: CurrencyCode;
  status: InvoiceStatus;
  dueDate?: ISO8601;
  issuedAt?: ISO8601;
  paidAt: ISO8601 | null;
}

export interface Receipt {
  tokenId: string;
  paymentId: UUID;
  sender: string;
  recipient: string;
  amount: number;
  asset: CurrencyCode;
  mintedAt: ISO8601;
}

export type RefundStatus = 'requested' | 'approved' | 'rejected' | 'processed';

export interface Refund {
  id: UUID;
  paymentId: UUID;
  amount: number;
  currency: CurrencyCode;
  status: RefundStatus;
  reason: string;
  requestedAt: ISO8601;
  resolvedAt: ISO8601 | null;
}

export interface SplitRecipient {
  address: string;
  basisPoints: number;
}

export interface Split {
  id: UUID;
  paymentId: UUID;
  recipients: SplitRecipient[];
  status: 'created' | 'executed';
  createdAt: ISO8601;
}
