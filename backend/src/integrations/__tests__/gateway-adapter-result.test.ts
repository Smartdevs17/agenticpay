import { describe, expect, it } from 'vitest';
import {
  BaseGatewayAdapter, GatewayCircuitOpenError, GatewayManager, type GatewayConfig, type GatewayType,
  type PaymentRequest, type PaymentResponse,
} from '../gateway-adapter.js';

const config: GatewayConfig = {
  gatewayType: 'stripe', enabled: true, priority: 1, maxRetries: 0,
  timeoutMs: 1000, healthCheckIntervalMs: 60000,
  circuitBreakerThreshold: 2, credentials: {},
};

class StubGateway extends BaseGatewayAdapter {
  response: PaymentResponse = { success: false, transactionId: 'tx1', status: 'failed' };
  constructor() { super(config); }
  getType(): GatewayType { return 'stripe'; }
  protected async executePayment(_request: PaymentRequest): Promise<PaymentResponse> {
    return this.response;
  }
  protected async performHealthCheck(): Promise<void> {}
}

const request: PaymentRequest = {
  amount: '1.00', currency: 'USD', recipient: 'test', idempotencyKey: 'key',
};

describe('gateway result accounting (#1177)', () => {
  it('records returned failures and opens circuit at threshold', async () => {
    const gateway = new StubGateway();
    await gateway.processPayment(request);
    expect(gateway.getHealthStatus().consecutiveFailures).toBe(1);
    expect(gateway.getHealthStatus().successRate).toBe(0);
    await gateway.processPayment(request);
    expect(gateway.getHealthStatus().isHealthy).toBe(false);
    await expect(gateway.processPayment(request)).rejects.toThrow('circuit is open');
  });

  it('resets failure streak after successful response', async () => {
    const gateway = new StubGateway();
    await gateway.processPayment(request);
    gateway.response = { success: true, transactionId: 'tx2', status: 'completed' };
    await gateway.processPayment(request);
    expect(gateway.getHealthStatus().consecutiveFailures).toBe(0);
    expect(gateway.getHealthStatus().successRate).toBe(0.5);
  });
});


describe('gateway manager safe fallback (#1182)', () => {
  it('does not replay a payment through another gateway after an ambiguous provider error', async () => {
    let firstCalls = 0;
    let fallbackCalls = 0;
    const first = {
      getType: () => 'stripe' as const,
      processPayment: async () => { firstCalls++; throw new Error('provider timeout'); },
      checkHealth: async () => true,
      getHealthStatus: () => ({ gatewayType: 'stripe' as const, isHealthy: true, lastCheckAt: new Date().toISOString(), responseTimeMs: 1, errorRate: 0, successRate: 1, consecutiveFailures: 0 }),
    };
    const fallback = {
      getType: () => 'paypal' as const,
      processPayment: async () => { fallbackCalls++; return { success: true, transactionId: 'tx2', status: 'completed' as const }; },
      checkHealth: async () => true,
      getHealthStatus: () => ({ gatewayType: 'paypal' as const, isHealthy: true, lastCheckAt: new Date().toISOString(), responseTimeMs: 1, errorRate: 0, successRate: 1, consecutiveFailures: 0 }),
    };
    const manager = new GatewayManager();
    manager.registerAdapter(first);
    manager.registerAdapter(fallback);

    await expect(manager.processPayment(request)).rejects.toThrow('provider timeout');
    expect(firstCalls).toBe(1);
    expect(fallbackCalls).toBe(0);
  });

  it('permits fallback only when a gateway rejects before calling its provider due to an open circuit', async () => {
    let fallbackCalls = 0;
    const openCircuit = {
      getType: () => 'stripe' as const,
      processPayment: async () => { throw new GatewayCircuitOpenError('circuit is open'); },
      checkHealth: async () => false,
      getHealthStatus: () => ({ gatewayType: 'stripe' as const, isHealthy: true, lastCheckAt: new Date().toISOString(), responseTimeMs: 1, errorRate: 0, successRate: 1, consecutiveFailures: 0 }),
    };
    const fallback = {
      getType: () => 'paypal' as const,
      processPayment: async () => { fallbackCalls++; return { success: true, transactionId: 'tx2', status: 'completed' as const }; },
      checkHealth: async () => true,
      getHealthStatus: () => ({ gatewayType: 'paypal' as const, isHealthy: true, lastCheckAt: new Date().toISOString(), responseTimeMs: 1, errorRate: 0, successRate: 1, consecutiveFailures: 0 }),
    };
    const manager = new GatewayManager();
    manager.registerAdapter(openCircuit);
    manager.registerAdapter(fallback);

    const result = await manager.processPayment(request);
    expect(result.gatewayUsed).toBe('paypal');
    expect(fallbackCalls).toBe(1);
  });
});
