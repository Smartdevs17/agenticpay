import { describe, it, expect, beforeEach } from 'vitest';
import { FiatPaymentProvider } from './fiat.js';
import { CreditPaymentProvider } from './credit.js';
import { resetAllCircuits, getCircuitState } from '../../../../../middleware/circuit-breaker.js';
import type { PaymentInput } from './types.js';

const baseInput: PaymentInput = {
  amount: 10,
  currency: 'USD',
  toAddress: 'acc_123',
  network: 'fiat',
  tenantId: 'tenant-1',
  metadata: { bankAccountId: 'ba_1', fiatMethod: 'ach' },
};

describe('Circuit breaker integration — fiat provider', () => {
  beforeEach(() => {
    resetAllCircuits();
  });

  it('processes a successful payment through the circuit breaker', async () => {
    const provider = new FiatPaymentProvider();
    const result = await provider.processPayment(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.providerId).toBe('fiat');
    const state = getCircuitState('fiat-provider');
    expect(state?.metrics.successfulCalls).toBeGreaterThanOrEqual(1);
  });

  it('records a failure when the underlying call throws', async () => {
    const provider = new FiatPaymentProvider();
    // Force a failure via invalid input that throws inside the circuit breaker
    const result = await provider.processPayment({ ...baseInput, amount: -5 });
    expect(result.ok).toBe(false);
  });

  it('refundPayment is guarded by the circuit breaker', async () => {
    const provider = new FiatPaymentProvider();
    const result = await provider.refundPayment('tx_1', 5);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.refundedAmount).toBe(5);
  });

  it('getStatus is guarded by the circuit breaker', async () => {
    const provider = new FiatPaymentProvider();
    const result = await provider.getStatus('tx_1');
    expect(result.ok).toBe(true);
  });

  it('healthCheck returns true', async () => {
    const provider = new FiatPaymentProvider();
    expect(await provider.healthCheck()).toBe(true);
  });

  it('validateConfig returns true with required keys', () => {
    const provider = new FiatPaymentProvider();
    expect(provider.validateConfig({ STRIPE_SECRET_KEY: 'sk_test_123' })).toBe(true);
  });
});

describe('Circuit breaker integration — credit provider', () => {
  beforeEach(() => {
    resetAllCircuits();
  });

  it('processes a successful payment through the circuit breaker', async () => {
    const provider = new CreditPaymentProvider();
    provider.topUp('tenant-1', 100);
    const result = await provider.processPayment(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.providerId).toBe('credit');
    const state = getCircuitState('credit-provider');
    expect(state?.metrics.successfulCalls).toBeGreaterThanOrEqual(1);
  });

  it('rejects insufficient credits through the circuit breaker', async () => {
    const provider = new CreditPaymentProvider();
    // No credits topped up
    const result = await provider.processPayment({ ...baseInput, amount: 1000 });
    expect(result.ok).toBe(false);
  });

  it('refundPayment is guarded by the circuit breaker', async () => {
    const provider = new CreditPaymentProvider();
    const result = await provider.refundPayment('tx_credit', 5);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.refundedAmount).toBe(5);
  });

  it('getStatus is guarded by the circuit breaker', async () => {
    const provider = new CreditPaymentProvider();
    const result = await provider.getStatus('tx_credit');
    expect(result.ok).toBe(true);
  });

  it('healthCheck returns true', async () => {
    const provider = new CreditPaymentProvider();
    expect(await provider.healthCheck()).toBe(true);
  });

  it('validateConfig returns true', () => {
    const provider = new CreditPaymentProvider();
    expect(provider.validateConfig({})).toBe(true);
  });
});
