import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { providerRegistry, type PaymentProviderRegistry } from './provider-registry.js';
import type { PaymentInput, PaymentOutput, PaymentProvider } from './providers/types.js';

const EVM_NETWORKS = new Set(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base']);
const FIAT_CURRENCIES = new Set(['USD', 'EUR', 'GBP']);

/**
 * Strategy selection: chain/network takes priority (a chain can only be
 * serviced by the provider that speaks its protocol), then token/currency
 * disambiguates within a chain-agnostic path (e.g. fiat rails vs. credit).
 */
export function selectProviderId(input: PaymentInput, preferredId?: string, registry: PaymentProviderRegistry = providerRegistry): string {
  if (preferredId && registry.get(preferredId)) return preferredId;
  if (input.network === 'stellar') return 'soroban';
  if (EVM_NETWORKS.has(input.network)) return 'evm';
  if (input.token ? FIAT_CURRENCIES.has(input.token) : FIAT_CURRENCIES.has(input.currency)) return 'fiat';
  return 'credit';
}

export class ProviderPaymentRouter extends BaseService {
  constructor(private readonly registry: PaymentProviderRegistry = providerRegistry) {
    super();
  }

  async route(input: PaymentInput, preferredProviderId?: string): Promise<Result<PaymentOutput>> {
    const primaryId = selectProviderId(input, preferredProviderId, this.registry);
    const candidateIds = [primaryId, ...this.registry.list().filter((id) => id !== primaryId)];

    for (const id of candidateIds) {
      const provider: PaymentProvider | undefined = this.registry.get(id);
      if (!provider) continue;

      const start = Date.now();
      const result = await provider.processPayment(input);
      const latencyMs = Date.now() - start;

      if (result.ok) {
        this.registry.recordSuccess(id, latencyMs);
        return this.ok({ ...result.value, providerId: id });
      }

      this.registry.recordError(id);
      // Continue to next fallback provider
    }

    return this.fail('All payment providers failed', 502, 'PROVIDER_UNAVAILABLE');
  }
}

export const providerPaymentRouter = new ProviderPaymentRouter();
