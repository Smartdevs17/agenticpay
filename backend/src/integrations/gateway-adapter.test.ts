import { describe, expect, it } from 'vitest';
import {
  BaseGatewayAdapter,
  type GatewayConfig,
  type PaymentRequest,
  type PaymentResponse,
} from './gateway-adapter';

const config: GatewayConfig = {
  gatewayType: 'stripe',
  enabled: true,
  priority: 1,
  maxRetries: 0,
  timeoutMs: 1_000,
  healthCheckIntervalMs: 60_000,
  circuitBreakerThreshold: 3,
  credentials: {},
};

const request: PaymentRequest = {
  amount: '12.50',
  currency: 'USD',
  recipient: 'acct_test',
  idempotencyKey: 'test-payment-1',
};

class TestGateway extends BaseGatewayAdapter {
  nextResponse: PaymentResponse = {
    success: true,
    transactionId: 'txn_test',
    status: 'completed',
  };
  shouldThrow = false;

  getType() {
    return this.config.gatewayType;
  }

  protected async executePayment(): Promise<PaymentResponse> {
    if (this.shouldThrow) throw new Error('provider unavailable');
    return this.nextResponse;
  }

  protected async performHealthCheck(): Promise<void> {}

  forceHalfOpen() {
    // Simulate the state after the circuit-breaker cooldown has elapsed.
    this.circuitState = 'half_open' as typeof this.circuitState;
  }
}

describe('BaseGatewayAdapter circuit-breaker payment outcomes', () => {
  it('records a resolved but failed payment as a failure', async () => {
    const gateway = new TestGateway(config);
    gateway.nextResponse = {
      success: false,
      transactionId: 'txn_failed',
      status: 'failed',
      errorCode: 'DECLINED',
    };

    const response = await gateway.processPayment(request);

    expect(response.status).toBe('failed');
    expect(gateway.getHealthStatus().consecutiveFailures).toBe(1);
    expect(gateway.getHealthStatus().errorRate).toBe(1);
    expect(gateway.getHealthStatus().successRate).toBe(0);
  });

  it('reopens the circuit immediately when a half-open probe throws', async () => {
    const gateway = new TestGateway(config);
    gateway.forceHalfOpen();
    gateway.shouldThrow = true;

    await expect(gateway.processPayment(request)).rejects.toThrow('provider unavailable');
    await expect(gateway.processPayment(request)).rejects.toThrow('circuit is open');
  });
});
