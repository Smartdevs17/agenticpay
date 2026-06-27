import { randomUUID } from 'node:crypto';
import { fromThrowable } from '../../../lib/result.js';
import { BaseService } from '../../BaseService.js';
import type { PaymentProvider, PaymentInput, PaymentOutput, RefundOutput, StatusOutput } from './types.js';

// In-memory credit ledger keyed by tenantId. A real deployment would persist this in Prisma.
const creditLedger = new Map<string, number>();

export class CreditPaymentProvider extends BaseService implements PaymentProvider {
  readonly id = 'credit';

  async processPayment(input: PaymentInput) {
    return fromThrowable(async () => {
      const balance = creditLedger.get(input.tenantId) ?? 0;
      if (balance < input.amount) {
        throw Object.assign(new Error('INSUFFICIENT_CREDITS'), { statusCode: 402, code: 'INSUFFICIENT_CREDITS' });
      }
      creditLedger.set(input.tenantId, balance - input.amount);

      const txHash = `credit_${randomUUID().replace(/-/g, '')}`;
      return {
        txHash,
        providerId: this.id,
        network: input.network,
        status: 'confirmed',
        raw: { creditsUsed: input.amount, remainingBalance: balance - input.amount },
      } satisfies PaymentOutput;
    });
  }

  async refundPayment(txId: string, amount?: number) {
    return fromThrowable(async () => {
      const refundHash = `credit_refund_${txId}`;
      return { txHash: refundHash, refundedAmount: amount ?? 0 } satisfies RefundOutput;
    });
  }

  async getStatus(txId: string) {
    return fromThrowable(async () => {
      // Credit transactions are synchronous — always confirmed immediately
      return { txHash: txId, status: 'confirmed', confirmations: 1 } satisfies StatusOutput;
    });
  }

  validateConfig(_config: Record<string, unknown>): boolean {
    return true;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  /** Top up credits for a tenant (for testing and admin flows). */
  topUp(tenantId: string, amount: number): void {
    creditLedger.set(tenantId, (creditLedger.get(tenantId) ?? 0) + amount);
  }

  getBalance(tenantId: string): number {
    return creditLedger.get(tenantId) ?? 0;
  }
}
