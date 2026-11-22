import type { AgeVerificationInput } from '../types/zk-types';
import { createHttpClient, type HttpClient } from '../lib/http-client.js';

export interface IdentityProviderConfig {
  id: string;
  name: string;
  endpoint: string;
  trusted: boolean;
}

const DEFAULT_PROVIDERS: IdentityProviderConfig[] = [
  {
    id: 'agenticpay-kyc',
    name: 'AgenticPay KYC',
    endpoint: process.env.IDENTITY_PROVIDER_URL ?? 'https://identity.agenticpay.local/v1',
    trusted: true,
  },
];

/**
 * Fetches signed birth-date attestations from a configured identity provider.
 * Falls back to client-supplied dates when the provider is unreachable.
 */
export class IdentityProviderClient {
  private readonly client: HttpClient;

  constructor(private readonly providers: IdentityProviderConfig[] = DEFAULT_PROVIDERS) {
    this.client = createHttpClient({
      defaultTimeoutMs: 5_000,
      headers: { Accept: 'application/json' },
    });
  }

  async fetchAgeAttestation(userId: string): Promise<Partial<AgeVerificationInput>> {
    const provider = this.providers.find((p) => p.trusted) ?? this.providers[0];
    if (!provider) return {};

    try {
      const payload = await this.client.get<{
        birthYear?: number;
        birthMonth?: number;
        birthDay?: number;
      }>(`${provider.endpoint}/attestations/${encodeURIComponent(userId)}`, {
        timeoutMs: 5_000,
      });

      return {
        birthYear: payload.birthYear,
        birthMonth: payload.birthMonth,
        birthDay: payload.birthDay,
      };
    } catch {
      return {};
    }
  }

  listProviders(): IdentityProviderConfig[] {
    return this.providers;
  }
}

export default IdentityProviderClient;
