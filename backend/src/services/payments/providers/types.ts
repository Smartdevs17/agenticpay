import type { Result } from '../../../lib/result.js';

export interface PaymentInput {
  amount: number;
  currency: string;
  fromAddress?: string;
  toAddress: string;
  network: string;
  tenantId: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentOutput {
  txHash: string;
  providerId: string;
  network: string;
  status: 'pending' | 'confirmed';
  raw?: unknown;
}

export interface RefundOutput {
  txHash: string;
  refundedAmount: number;
}

export interface StatusOutput {
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  confirmations?: number;
}

export interface ProviderMetrics {
  successCount: number;
  errorCount: number;
  totalLatencyMs: number;
  lastErrorAt?: number;
}

export interface PaymentProvider {
  readonly id: string;
  processPayment(input: PaymentInput): Promise<Result<PaymentOutput>>;
  refundPayment(txId: string, amount?: number): Promise<Result<RefundOutput>>;
  getStatus(txId: string): Promise<Result<StatusOutput>>;
  validateConfig(config: Record<string, unknown>): boolean;
  healthCheck(): Promise<boolean>;
}
