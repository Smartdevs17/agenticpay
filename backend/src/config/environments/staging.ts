import type { EnvironmentOverrides } from './types.js';

export const stagingOverrides: EnvironmentOverrides = {
  CORS_ALLOWED_ORIGINS: 'https://staging.agenticpay.app',
  STELLAR_NETWORK: 'testnet',
  JOBS_ENABLED: 'true',
  QUEUE_ENABLED: 'true',
  RATE_LIMIT_FREE: '100',
  RATE_LIMIT_PRO: '300',
  RATE_LIMIT_ENTERPRISE: '1000',
  AWS_SECRETS_MANAGER_ENABLED: 'true',
  AWS_SECRETS_MANAGER_SECRET_ID: 'agenticpay-staging-app-secrets',
};
