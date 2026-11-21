import type { AgeVerificationInput } from '../types/zk-types';

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
  constructor(private readonly providers: IdentityProviderConfig[] = DEFAULT_PROVIDERS) {}

  async fetchAgeAttestation(userId: string): Promise<Partial<AgeVerificationInput>> {
    const provider = this.providers.find((p) => p.trusted) ?? this.providers[0];
    if (!provider) return {};

    try {
      const response = await fetch(`${provider.endpoint}/attestations/${encodeURIComponent(userId)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) return {};
      const payload = (await response.json()) as {
        birthYear?: number;
        birthMonth?: number;
        birthDay?: number;
      };

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
