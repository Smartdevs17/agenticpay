import { randomUUID } from 'node:crypto';
import { fromThrowable } from '../../../lib/result.js';
import { BaseService } from '../../BaseService.js';
import { withCircuitBreaker } from '../../../middleware/circuit-breaker.js';
import { razorpayClient, RazorpayClient } from '../../../integrations/razorpay/index.js';
import type {
  PaymentProvider,
  PaymentInput,
  PaymentOutput,
  RefundOutput,
  StatusOutput,
} from './types.js';

const CIRCUIT_NAME = 'razorpay-provider';

export class RazorpayPaymentProvider extends BaseService implements PaymentProvider {
  readonly id = 'razorpay';
  private client: RazorpayClient;

  constructor(client: RazorpayClient = razorpayClient) {
    super();
    this.client = client;
  }

  async processPayment(input: PaymentInput) {
    return fromThrowable(async () =>
      withCircuitBreaker(CIRCUIT_NAME, async () => {
        // Razorpay amounts are in the smallest currency sub-unit (paise for INR, cents for USD)
        const amountInSubunits = Math.round(input.amount * 100);
        const receipt = (input.metadata?.['receipt'] as string | undefined) ||
          `rcpt_${randomUUID().replace(/-/g, '').substring(0, 14)}`;

        const order = await this.client.createOrder({
          amount: amountInSubunits,
          currency: input.currency || 'INR',
          receipt,
          notes: {
            tenantId: input.tenantId,
            toAddress: input.toAddress,
            fromAddress: input.fromAddress || '',
            ...(input.metadata as Record<string, string> || {}),
          },
        });

        return {
          txHash: order.id,
          providerId: this.id,
          network: input.network || 'razorpay',
          status: order.status === 'paid' ? 'confirmed' : 'pending',
          metadata: {
            orderId: order.id,
            receipt: order.receipt,
          },
          raw: {
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            status: order.status,
            receipt: order.receipt,
          },
        } as PaymentOutput;
      }),
    );
  }

  async refundPayment(txId: string, amount?: number) {
    return fromThrowable(async () =>
      withCircuitBreaker(CIRCUIT_NAME, async () => {
        const amountInSubunits = amount !== undefined ? Math.round(amount * 100) : undefined;
        const refundResponse = await this.client.createRefund({
          paymentId: txId,
          amount: amountInSubunits,
          notes: {
            reason: 'AgenticPay refund request',
          },
        });

        const refundedUnits = refundResponse.amount ? refundResponse.amount / 100 : (amount ?? 0);

        return {
          txHash: refundResponse.id || `razorpay_rfnd_${randomUUID().replace(/-/g, '')}`,
          refundedAmount: refundedUnits,
        } satisfies RefundOutput;
      }),
    );
  }

  async getStatus(txId: string) {
    return fromThrowable(async () =>
      withCircuitBreaker(CIRCUIT_NAME, async () => {
        try {
          if (txId.startsWith('order_')) {
            const order = await this.client.getOrder(txId);
            return {
              txHash: txId,
              status: order.status === 'paid' ? 'confirmed' : 'pending',
            } satisfies StatusOutput;
          }

          const payment = await this.client.getPayment(txId);
          const statusMap: Record<string, StatusOutput['status']> = {
            captured: 'confirmed',
            authorized: 'pending',
            created: 'pending',
            refunded: 'confirmed',
            failed: 'failed',
          };

          return {
            txHash: txId,
            status: statusMap[payment.status] || 'pending',
          } satisfies StatusOutput;
        } catch {
          return {
            txHash: txId,
            status: 'pending',
          } satisfies StatusOutput;
        }
      }),
    );
  }

  validateConfig(config: Record<string, unknown>): boolean {
    const keyId = config['RAZORPAY_KEY_ID'] || config['keyId'];
    const keySecret = config['RAZORPAY_KEY_SECRET'] || config['keySecret'];
    return Boolean(keyId && keySecret);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

export const razorpayPaymentProvider = new RazorpayPaymentProvider();
