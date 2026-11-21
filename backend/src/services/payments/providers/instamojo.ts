import { randomUUID } from 'node:crypto';
import { fromThrowable } from '../../../lib/result.js';
import { BaseService } from '../../BaseService.js';
import { withCircuitBreaker } from '../../../middleware/circuit-breaker.js';
import { instamojoClient, InstamojoClient } from '../../../integrations/instamojo/index.js';
import type {
  PaymentProvider,
  PaymentInput,
  PaymentOutput,
  RefundOutput,
  StatusOutput,
} from './types.js';

const CIRCUIT_NAME = 'instamojo-provider';

export class InstamojoPaymentProvider extends BaseService implements PaymentProvider {
  readonly id = 'instamojo';
  private client: InstamojoClient;

  constructor(client: InstamojoClient = instamojoClient) {
    super();
    this.client = client;
  }

  async processPayment(input: PaymentInput) {
    return fromThrowable(async () =>
      withCircuitBreaker(CIRCUIT_NAME, async () => {
        const purpose = (input.metadata?.['purpose'] as string | undefined) ||
          `Payment for ${input.tenantId}`;
        const buyerName = (input.metadata?.['buyerName'] as string | undefined) ||
          (input.metadata?.['customerName'] as string | undefined) ||
          'AgenticPay Customer';
        const email = (input.metadata?.['buyerEmail'] as string | undefined) ||
          (input.metadata?.['email'] as string | undefined) ||
          `user-${input.tenantId}@example.com`;
        const phone = (input.metadata?.['buyerPhone'] as string | undefined) ||
          (input.metadata?.['phone'] as string | undefined) ||
          '+919999999999';
        const redirectUrl = (input.metadata?.['redirectUrl'] as string | undefined);
        const webhookUrl = (input.metadata?.['webhookUrl'] as string | undefined);

        const paymentRequest = await this.client.createPaymentRequest({
          purpose,
          amount: input.amount,
          buyerName,
          email,
          phone,
          redirectUrl,
          webhookUrl,
        });

        return {
          txHash: paymentRequest.id,
          providerId: this.id,
          network: input.network || 'instamojo',
          status: paymentRequest.status === 'Completed' ? 'confirmed' : 'pending',
          raw: {
            paymentRequestId: paymentRequest.id,
            paymentUrl: paymentRequest.longurl,
            status: paymentRequest.status,
          },
        } satisfies PaymentOutput;
      }),
    );
  }

  async refundPayment(txId: string, amount?: number) {
    return fromThrowable(async () =>
      withCircuitBreaker(CIRCUIT_NAME, async () => {
        const refundResponse = await this.client.createRefund({
          paymentId: txId,
          type: 'RFD',
          body: 'Customer refund request via AgenticPay',
          refundAmount: amount,
        });

        return {
          txHash: refundResponse.id || `instamojo_refund_${randomUUID().replace(/-/g, '')}`,
          refundedAmount: Number(refundResponse.refundAmount || amount || 0),
        } satisfies RefundOutput;
      }),
    );
  }

  async getStatus(txId: string) {
    return fromThrowable(async () =>
      withCircuitBreaker(CIRCUIT_NAME, async () => {
        try {
          const payment = await this.client.getPayment(txId);
          return {
            txHash: txId,
            status: payment.status === 'Credit' ? 'confirmed' : 'failed',
          } satisfies StatusOutput;
        } catch {
          // If not found directly as payment ID, try checking as payment request ID
          const pr = await this.client.getPaymentRequest(txId);
          const statusMap: Record<string, StatusOutput['status']> = {
            Completed: 'confirmed',
            Failed: 'failed',
            Pending: 'pending',
          };
          return {
            txHash: txId,
            status: statusMap[pr.status] || 'pending',
          } satisfies StatusOutput;
        }
      }),
    );
  }

  validateConfig(config: Record<string, unknown>): boolean {
    return Boolean(config['INSTAMOJO_API_KEY'] && config['INSTAMOJO_AUTH_TOKEN']);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

export const instamojoPaymentProvider = new InstamojoPaymentProvider();
