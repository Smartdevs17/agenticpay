import type { Env } from '../../config/env.js';

export const createTestEnv = (overrides: Partial<Env> = {}): Env => ({
  NODE_ENV: 'test',
  PORT: 3001,
  CORS_ALLOWED_ORIGINS: '*',
  STELLAR_NETWORK: 'testnet',
  OPENAI_API_KEY: 'test-openai-key',
  JOBS_ENABLED: true,
  QUEUE_ENABLED: true,
  RATE_LIMIT_FREE: 100,
  RATE_LIMIT_PRO: 300,
  RATE_LIMIT_ENTERPRISE: 1000,
  RATE_LIMIT_WINDOW_MS: 900000,
  IP_ALLOWLIST: '',
  IP_ALLOWLIST_ENABLED: false,
  IP_ALLOWLIST_BYPASS_ENABLED: false,
  IP_ALLOWLIST_BYPASS_EXPIRY_MS: 1800000,
  ...overrides,
});

export const developmentEnv = createTestEnv({ NODE_ENV: 'development' });
export const stagingEnv = createTestEnv({
  NODE_ENV: 'development',
  CORS_ALLOWED_ORIGINS: 'https://staging.agenticpay.app',
} as any);
export const productionEnv = createTestEnv({
  NODE_ENV: 'production',
  CORS_ALLOWED_ORIGINS: 'https://app.agenticpay.io',
  STELLAR_NETWORK: 'public',
  RATE_LIMIT_FREE: 60,
  RATE_LIMIT_PRO: 300,
  RATE_LIMIT_ENTERPRISE: 2000,
} as any);