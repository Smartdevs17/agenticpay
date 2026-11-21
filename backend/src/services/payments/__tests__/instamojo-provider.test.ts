process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-mock-key';

import { describe, it, expect, beforeEach } from 'vitest';
import { InstamojoPaymentProvider } from '../providers/instamojo.js';
import { providerRegistry } from '../provider-registry.js';
import { selectProviderId } from '../payment-router.js';
import { registerDefaultPaymentProviders } from '../bootstrap.js';
import type { PaymentInput } from '../providers/types.js';

describe('InstamojoPaymentProvider', () => {
  let provider: InstamojoPaymentProvider;

  beforeEach(() => {
    provider = new InstamojoPaymentProvider();
  });

  it('identifies as instamojo', () => {
    expect(provider.id).toBe('instamojo');
  });

  it('processes a payment successfully', async () => {
    const input: PaymentInput = {
      amount: 1500,
      currency: 'INR',
      network: 'instamojo',
      fromAddress: 'user_1',
      toAddress: 'merchant_1',
      tenantId: 'tenant_test',
      metadata: {
        purpose: 'Annual membership',
        buyerName: 'Ravi Kumar',
        email: 'ravi@example.com',
        phone: '+919876543210',
      },
    };

    const result = await provider.processPayment(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.providerId).toBe('instamojo');
      expect(result.value.status).toBe('pending');
      expect(result.value.txHash).toBeDefined();
    }
  });

  it('handles refund requests', async () => {
    const result = await provider.refundPayment('MOJO_pay_123', 500);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.refundedAmount).toBe(500);
      expect(result.value.txHash).toBeDefined();
    }
  });

  it('checks status of a transaction', async () => {
    const result = await provider.getStatus('MOJO_pay_123');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('confirmed');
    }
  });

  it('validates configuration correctly', () => {
    expect(provider.validateConfig({})).toBe(false);
    expect(
      provider.validateConfig({
        INSTAMOJO_API_KEY: 'key_123',
        INSTAMOJO_AUTH_TOKEN: 'token_123',
      })
    ).toBe(true);
  });

  it('passes health check', async () => {
    expect(await provider.healthCheck()).toBe(true);
  });
});

describe('Payment Router with Instamojo', () => {
  beforeEach(() => {
    registerDefaultPaymentProviders(providerRegistry);
  });

  it('routes INR payments to instamojo', () => {
    const selected = selectProviderId({
      amount: 100,
      currency: 'INR',
      toAddress: 'merchant',
      network: 'instamojo',
      tenantId: 'tenant_1',
    });
    expect(selected).toBe('instamojo');
  });

  it('routes instamojo network to instamojo', () => {
    const selected = selectProviderId({
      amount: 100,
      currency: 'USD',
      toAddress: 'merchant',
      network: 'instamojo',
      tenantId: 'tenant_1',
    });
    expect(selected).toBe('instamojo');
  });

  it('lists instamojo as a registered provider in the registry', () => {
    expect(providerRegistry.get('instamojo')).toBeDefined();
    expect(providerRegistry.list()).toContain('instamojo');
  });
});
