import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentProviderRegistry } from '../provider-registry.js';
import { ProviderPaymentRouter, selectProviderId } from '../payment-router.js';
import { MockPaymentProvider } from '../providers/mock.js';
import type { PaymentInput } from '../providers/types.js';

const baseInput: PaymentInput = {
  amount: 10,
  currency: 'XLM',
  toAddress: 'GABC',
  network: 'stellar',
  tenantId: 'tenant-1',
};

describe('selectProviderId', () => {
  it('routes stellar network to the soroban strategy', () => {
    expect(selectProviderId({ ...baseInput, network: 'stellar' })).toBe('soroban');
  });

  it('routes EVM networks to the evm strategy', () => {
    expect(selectProviderId({ ...baseInput, network: 'polygon' })).toBe('evm');
  });

  it('routes fiat currency to the fiat strategy', () => {
    expect(selectProviderId({ ...baseInput, network: 'other', currency: 'USD' })).toBe('fiat');
  });

  it('routes by token symbol when provided, overriding currency', () => {
    expect(selectProviderId({ ...baseInput, network: 'other', currency: 'XLM', token: 'EUR' })).toBe('fiat');
  });

  it('falls back to credit for anything unrecognized', () => {
    expect(selectProviderId({ ...baseInput, network: 'other', currency: 'POINTS' })).toBe('credit');
  });
});

describe('ProviderPaymentRouter', () => {
  let registry: PaymentProviderRegistry;
  let router: ProviderPaymentRouter;

  beforeEach(() => {
    registry = new PaymentProviderRegistry();
    router = new ProviderPaymentRouter(registry);
  });

  it('routes to the strategy selected for the network', async () => {
    registry.register(new MockPaymentProvider('soroban'));
    registry.register(new MockPaymentProvider('evm'));

    const result = await router.route({ ...baseInput, network: 'stellar' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.providerId).toBe('soroban');
  });

  it('falls back to another healthy strategy when the primary one fails', async () => {
    registry.register(new MockPaymentProvider('soroban', { shouldFail: true }));
    registry.register(new MockPaymentProvider('evm'));

    const result = await router.route({ ...baseInput, network: 'stellar' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.providerId).toBe('evm');
    expect(registry.getMetrics('soroban').errorCount).toBe(1);
  });

  it('fails when every strategy fails', async () => {
    registry.register(new MockPaymentProvider('soroban', { shouldFail: true }));

    const result = await router.route({ ...baseInput, network: 'stellar' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('respects an explicit preferred provider override', async () => {
    registry.register(new MockPaymentProvider('soroban'));
    registry.register(new MockPaymentProvider('evm'));

    const result = await router.route({ ...baseInput, network: 'stellar' }, 'evm');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.providerId).toBe('evm');
  });
});
