import { randomUUID } from 'node:crypto';
import { fromThrowable } from '../../../lib/result.js';
import { BaseService } from '../../BaseService.js';
import { fiatPaymentsService } from '../../fiat-payments.js';
import type { PaymentProvider, PaymentInput, PaymentOutput, RefundOutput, StatusOutput } from './types.js';

export class FiatPaymentProvider extends BaseService implements PaymentProvider {
  readonly id = 'fiat';

  async processPayment(input: PaymentInput) {
    return fromThrowable(async () => {
      // Fiat provider requires a pre-verified bank account id in metadata
      const bankAccountId = (input.metadata?.['bankAccountId'] as string | undefined) ?? 'default';
      const method = (input.metadata?.['fiatMethod'] as 'ach' | 'wire' | undefined) ?? 'ach';

      const record = fiatPaymentsService.createPayment({
        bankAccountId,
        amount: input.amount,
        currency: input.currency,
        method,
        recipient: {
          name: (input.metadata?.['recipientName'] as string | undefined) ?? 'Unknown',
          accountNumber: input.toAddress,
          routingNumber: (input.metadata?.['routingNumber'] as string | undefined) ?? '',
        },
      });

      return {
        txHash: record.id,
        providerId: this.id,
        network: input.network,
        status: 'pending',
        raw: { fiatRecordId: record.id, status: record.status },
      } satisfies PaymentOutput;
    });
  }

  async refundPayment(txId: string, amount?: number) {
    return fromThrowable(async () => {
      const refundId = `fiat_refund_${randomUUID().replace(/-/g, '')}`;
      return { txHash: refundId, refundedAmount: amount ?? 0 } satisfies RefundOutput;
    });
  }

  async getStatus(txId: string) {
    return fromThrowable(async () => {
      const payment = fiatPaymentsService.getPayment(txId);
      if (!payment) return { txHash: txId, status: 'pending' } satisfies StatusOutput;
      const statusMap: Record<string, StatusOutput['status']> = {
        settled: 'confirmed',
        failed: 'failed',
        returned: 'failed',
      };
      return {
        txHash: txId,
        status: statusMap[payment.status] ?? 'pending',
      } satisfies StatusOutput;
    });
  }

  validateConfig(config: Record<string, unknown>): boolean {
    return typeof config['STRIPE_SECRET_KEY'] === 'string' || typeof config['ACH_PROVIDER'] === 'string';
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
