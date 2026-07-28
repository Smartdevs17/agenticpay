import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { providerRegistry } from './provider-registry.js';
import type { PaymentInput, PaymentOutput, PaymentProvider } from './providers/types.js';

const EVM_NETWORKS = new Set(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base']);

function selectProviderId(input: PaymentInput, preferredId?: string): string {
  if (preferredId && providerRegistry.get(preferredId)) return preferredId;
  if (input.network === 'stellar') return 'soroban';
  if (EVM_NETWORKS.has(input.network)) return 'evm';
  if (input.currency === 'USD' || input.currency === 'EUR') return 'fiat';
  return 'credit';
}

export class ProviderPaymentRouter extends BaseService {
  async route(input: PaymentInput, preferredProviderId?: string): Promise<Result<PaymentOutput>> {
    const primaryId = selectProviderId(input, preferredProviderId);
    const candidateIds = [primaryId, ...providerRegistry.list().filter((id) => id !== primaryId)];

    for (const id of candidateIds) {
      const provider: PaymentProvider | undefined = providerRegistry.get(id);
      if (!provider) continue;

      const start = Date.now();
      const result = await provider.processPayment(input);
      const latencyMs = Date.now() - start;

      if (result.ok) {
        providerRegistry.recordSuccess(id, latencyMs);
        return this.ok({ ...result.value, providerId: id });
      }

      providerRegistry.recordError(id);
      // Continue to next fallback provider
    }

    return this.fail('All payment providers failed', 502, 'PROVIDER_UNAVAILABLE');
  }
}

export const providerPaymentRouter = new ProviderPaymentRouter();
