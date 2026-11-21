import {
  BaseGatewayAdapter,
  type GatewayConfig,
  type PaymentRequest,
  type PaymentResponse,
  type GatewayType,
} from '../gateway-adapter.js';
import { InstamojoClient, instamojoClient } from './instamojo-client.js';

export interface InstamojoGatewayConfig extends Omit<GatewayConfig, 'gatewayType'> {
  gatewayType?: 'instamojo';
  apiKey?: string;
  authToken?: string;
  privateSalt?: string;
  endpointUrl?: string;
  sandbox?: boolean;
}

export class InstamojoGatewayAdapter extends BaseGatewayAdapter {
  private client: InstamojoClient;

  constructor(config: InstamojoGatewayConfig) {
    super({
      ...config,
      gatewayType: 'instamojo',
    });

    this.client = new InstamojoClient({
      apiKey: config.apiKey || config.credentials?.['apiKey'],
      authToken: config.authToken || config.credentials?.['authToken'],
      privateSalt: config.privateSalt || config.credentials?.['privateSalt'],
      endpointUrl: config.endpointUrl || config.credentials?.['endpointUrl'],
      sandbox: config.sandbox,
    });
  }

  getType(): GatewayType {
    return 'instamojo';
  }

  protected async executePayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      const purpose = (request.metadata?.['purpose'] as string | undefined) ||
        `Payment ${request.idempotencyKey}`;
      const buyerName = (request.metadata?.['buyerName'] as string | undefined) ||
        (request.metadata?.['customerName'] as string | undefined) ||
        'AgenticPay Customer';
      const email = (request.metadata?.['email'] as string | undefined) ||
        `${request.recipient}@example.com`;
      const phone = (request.metadata?.['phone'] as string | undefined) || '+919999999999';

      const result = await this.client.createPaymentRequest({
        purpose,
        amount: request.amount,
        buyerName,
        email,
        phone,
        redirectUrl: request.metadata?.['redirectUrl'] as string | undefined,
        webhookUrl: request.metadata?.['webhookUrl'] as string | undefined,
      });

      return {
        success: true,
        transactionId: result.id,
        status: result.status === 'Completed' ? 'completed' : 'pending',
        gatewayResponse: result,
      };
    } catch (error) {
      return {
        success: false,
        transactionId: request.idempotencyKey,
        status: 'failed',
        errorCode: 'INSTAMOJO_ERROR',
        errorMessage: error instanceof Error ? error.message : 'Unknown Instamojo error',
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
