import {
  BaseGatewayAdapter,
  type GatewayConfig,
  type PaymentRequest,
  type PaymentResponse,
  type GatewayType,
} from '../gateway-adapter.js';
import { RazorpayClient, razorpayClient } from './razorpay-client.js';

export interface RazorpayGatewayConfig extends Omit<GatewayConfig, 'gatewayType'> {
  gatewayType?: 'razorpay';
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
}

export class RazorpayGatewayAdapter extends BaseGatewayAdapter {
  private client: RazorpayClient;

  constructor(config: RazorpayGatewayConfig) {
    super({
      ...config,
      gatewayType: 'razorpay',
    });

    this.client = new RazorpayClient({
      keyId: config.keyId || config.credentials?.['keyId'],
      keySecret: config.keySecret || config.credentials?.['keySecret'],
      webhookSecret: config.webhookSecret || config.credentials?.['webhookSecret'],
    });
  }

  getType(): GatewayType {
    return 'razorpay';
  }

  protected async executePayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      // Amount in paise / smallest currency unit
      const parsedAmount = Math.round(parseFloat(request.amount) * 100);
      const receipt = (request.metadata?.['receipt'] as string | undefined) || request.idempotencyKey;

      const order = await this.client.createOrder({
        amount: parsedAmount,
        currency: request.currency || 'INR',
        receipt,
        notes: {
          recipient: request.recipient,
          idempotencyKey: request.idempotencyKey,
          ...(request.metadata as Record<string, string> || {}),
        },
      });

      return {
        success: true,
        transactionId: order.id,
        status: order.status === 'paid' ? 'completed' : 'pending',
        gatewayResponse: order,
      };
    } catch (error) {
      return {
        success: false,
        transactionId: request.idempotencyKey,
        status: 'failed',
        errorCode: 'RAZORPAY_ERROR',
        errorMessage: error instanceof Error ? error.message : 'Unknown Razorpay error',
      };
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      this.health.isHealthy = true;
      this.health.lastCheckAt = new Date().toISOString();
      return true;
    } catch {
      this.health.isHealthy = false;
      this.health.lastCheckAt = new Date().toISOString();
      return false;
    }
  }
}
