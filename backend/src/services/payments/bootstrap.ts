/**
 * bootstrap.ts — Issue #726
 *
 * Registers the concrete multi-chain PaymentProvider strategies into the
 * singleton `providerRegistry` used by `payment-router.ts` /
 * `unified-payment-tracker.ts`. This registration previously only happened
 * inside `di/container.ts`'s `initialize()` method, which nothing in the
 * running app ever calls — so `providerRegistry.list()` was empty and every
 * call to `/payment-strategies/pay` would have failed with "All payment
 * providers failed" (no provider registered to route to). Call
 * `registerDefaultPaymentProviders()` once at app startup, before the
 * payment-strategies routes are reachable.
 */
import { providerRegistry, type PaymentProviderRegistry } from './provider-registry.js';
import { SorobanPaymentProvider } from './providers/soroban.js';
import { EvmPaymentProvider } from './providers/evm.js';
import { FiatPaymentProvider } from './providers/fiat.js';
import { CreditPaymentProvider } from './providers/credit.js';

export function registerDefaultPaymentProviders(registry: PaymentProviderRegistry = providerRegistry): void {
  registry.register(new SorobanPaymentProvider());
  registry.register(new EvmPaymentProvider());
  registry.register(new FiatPaymentProvider());
  registry.register(new CreditPaymentProvider());
}
