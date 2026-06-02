import type { UserTier } from '../middleware/rate-limit.js';

export interface ApiKeyRecord {
  key: string;
  tier: UserTier;
  label?: string;
  customHourlyLimit?: number;
}

/**
 * Resolve API key metadata for tier-based rate limiting.
 * Production deployments should replace this with a database lookup.
 */
const KEY_REGISTRY: Record<string, ApiKeyRecord> = {
  'apk_free_demo_key_00000000000000000000000001': {
    key: 'apk_free_demo_key_00000000000000000000000001',
    tier: 'free',
    label: 'demo-free',
  },
  'apk_pro_demo_key_00000000000000000000000000001': {
    key: 'apk_pro_demo_key_00000000000000000000000000001',
    tier: 'pro',
    label: 'demo-pro',
  },
  'apk_ent_demo_key_00000000000000000000000000001': {
    key: 'apk_ent_demo_key_00000000000000000000000000001',
    tier: 'enterprise',
    label: 'demo-enterprise',
    customHourlyLimit: 50_000,
  },
};

export function lookupApiKey(rawKey: string): ApiKeyRecord | null {
  const normalized = rawKey.trim();
  return KEY_REGISTRY[normalized] ?? null;
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '***';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export default { lookupApiKey, maskApiKey };
