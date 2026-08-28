/**
 * bootstrap.test.ts — Issue #726
 *
 * Regression test: `providerRegistry.register(...)` for the four concrete
 * strategies previously only happened inside `di/container.ts`'s
 * `initialize()`, which nothing in the running app called — so
 * `providerRegistry.list()` was empty and every `/payment-strategies/pay`
 * request would fail with PROVIDER_UNAVAILABLE. `registerDefaultPaymentProviders`
 * is now called from `index.ts` at startup.
 */
import { describe, it, expect } from 'vitest';
import { PaymentProviderRegistry } from '../provider-registry.js';
import { registerDefaultPaymentProviders } from '../bootstrap.js';
import { selectProviderId } from '../payment-router.js';

describe('registerDefaultPaymentProviders', () => {
  it('registers all four chain/rail strategies', () => {
    const registry = new PaymentProviderRegistry();

    registerDefaultPaymentProviders(registry);

    expect(registry.list().sort()).toEqual(['credit', 'evm', 'fiat', 'soroban']);
  });

  it('resolves a registered provider for every strategy selectProviderId can pick', () => {
    const registry = new PaymentProviderRegistry();
    registerDefaultPaymentProviders(registry);

    for (const id of ['soroban', 'evm', 'fiat', 'credit']) {
      expect(registry.get(id)).toBeDefined();
    }
    expect(selectProviderId({ amount: 1, currency: 'XLM', toAddress: 'G', network: 'stellar', tenantId: 't' })).toBe('soroban');
  });
});
