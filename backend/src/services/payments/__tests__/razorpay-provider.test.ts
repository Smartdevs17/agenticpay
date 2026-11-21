process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-mock-key';

import { describe, it, expect, beforeEach } from 'vitest';
import { RazorpayPaymentProvider } from '../providers/razorpay.js';
import { providerRegistry } from '../provider-registry.js';
import { selectProviderId } from '../payment-router.js';
import { registerDefaultPaymentProviders } from '../bootstrap.js';
import type { PaymentInput } from '../providers/types.js';

describe('RazorpayPaymentProvider', () => {
  let provider: RazorpayPaymentProvider;

  beforeEach(() => {
    provider = new RazorpayPaymentProvider();
  });

  it('identifies as razorpay', () => {
    expect(provider.id).toBe('razorpay');
  });

  it('processes a payment successfully', async () => {
    const input: PaymentInput = {
      amount: 150000,
      currency: 'INR',
      network: 'razorpay',
      fromAddress: 'user_cust_1',
      toAddress: 'merchant_acc_1',
      tenantId: 'tenant_test',
      metadata: {
        receipt: 'rcpt_test_101',
        description: 'Pro Plan Subscription',
        notes: { planId: 'plan_premium' },
      },
    };

    const result = await provider.processPayment(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.providerId).toBe('razorpay');
      expect(result.value.status).toBe('pending');
      expect(result.value.txHash).toBeDefined();
      expect(result.value.metadata?.orderId).toBeDefined();
    }
  });

  it('handles refund requests', async () => {
    const result = await provider.refundPayment('pay_test_123', 25000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.refundedAmount).toBe(25000);
      expect(result.value.txHash).toBeDefined();
    }
  });

  it('checks status of a transaction', async () => {
    const result = await provider.getStatus('pay_test_123');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('confirmed');
    }
  });

  it('validates configuration correctly', () => {
    expect(provider.validateConfig({ keyId: 'key', keySecret: 'secret' })).toBe(true);
    expect(provider.validateConfig({ keyId: 'key' })).toBe(false);
    expect(provider.validateConfig({})).toBe(false);
  });

  it('passes health check', async () => {
    const isHealthy = await provider.healthCheck();
    expect(isHealthy).toBe(true);
  });
});

describe('Razorpay Routing and Registry', () => {
  it('registers razorpay provider during bootstrap', () => {
    registerDefaultPaymentProviders();
    const retrieved = providerRegistry.get('razorpay');
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe('razorpay');
  });

  it('selects razorpay provider when network is razorpay', () => {
    const providerId = selectProviderId({
      amount: 5000,
      currency: 'INR',
      network: 'razorpay',
      fromAddress: '0x123',
      toAddress: '0x456',
    });
    expect(providerId).toBe('razorpay');
  });
});
