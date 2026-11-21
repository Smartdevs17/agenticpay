import type { CurrencyCode, ISO8601, UUID } from './primitives.js';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'executed'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'refunded';

export type PaymentType = 'milestone_payment' | 'full_payment' | 'refund';

export type PaymentTriggerType = 'immediate' | 'scheduled' | 'conditional';

export interface PaymentTrigger {
  type: PaymentTriggerType;
  executeAt?: ISO8601;
  condition?: string;
}

export interface Payment {
  id: UUID;
  from: string;
  to: string;
  amount: number;
  asset: CurrencyCode;
  currency?: CurrencyCode;
  status: PaymentStatus;
  type?: PaymentType;
  trigger?: PaymentTrigger;
  transactionHash?: string;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

export interface Transaction {
  id: UUID;
  paymentId: UUID;
  hash: string;
  network: string;
  status: PaymentStatus;
  amount: number;
  currency: CurrencyCode;
  createdAt: ISO8601;
  confirmedAt?: ISO8601 | null;
}

export interface Merchant {
  id: UUID;
  name: string;
  walletAddress: string;
  defaultCurrency: CurrencyCode;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}
