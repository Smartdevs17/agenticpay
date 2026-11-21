import { randomUUID } from 'node:crypto';
import { ok, err } from '../../../lib/result.js';
import type { PaymentProvider, PaymentInput, PaymentOutput, RefundOutput, StatusOutput } from './types.js';

/**
 * In-memory strategy implementation for unit tests and local dev. Never
 * touches a real chain — deterministic, synchronous outcomes controlled by
 * the caller so strategy-selection/fallback/tracking logic can be tested
 * without mocking Stellar/EVM SDKs.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly id: string;
  private readonly shouldFail: boolean;
  private readonly statuses = new Map<string, StatusOutput>();

  constructor(id = 'mock', options: { shouldFail?: boolean } = {}) {
    this.id = id;
    this.shouldFail = options.shouldFail ?? false;
  }

  async processPayment(input: PaymentInput) {
    if (this.shouldFail) {
      return err({ code: 'MOCK_PROVIDER_FAILURE', message: `${this.id} provider forced failure`, statusCode: 502 });
    }

    const txHash = `mock_${randomUUID().replace(/-/g, '')}`;
    const output: PaymentOutput = {
      txHash,
      providerId: this.id,
      network: input.network,
      status: 'pending',
      raw: { amount: input.amount, currency: input.currency },
    };
    this.statuses.set(txHash, { txHash, status: 'pending' });
    return ok(output);
  }

  async refundPayment(txId: string, amount?: number) {
    return ok({ txHash: `${txId}_refund`, refundedAmount: amount ?? 0 } satisfies RefundOutput);
  }

  async getStatus(txId: string) {
    return ok(this.statuses.get(txId) ?? { txHash: txId, status: 'confirmed' as const });
  }

  validateConfig(): boolean {
    return true;
  }

  async healthCheck(): Promise<boolean> {
    return !this.shouldFail;
  }

  /** Test helper: mark a previously processed tx as confirmed. */
  confirm(txHash: string): void {
    this.statuses.set(txHash, { txHash, status: 'confirmed', confirmations: 1 });
  }
}
