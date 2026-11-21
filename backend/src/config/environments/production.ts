import type { EnvironmentOverrides } from './types.js';

export const productionOverrides: EnvironmentOverrides = {
  CORS_ALLOWED_ORIGINS: 'https://app.agenticpay.io',
  STELLAR_NETWORK: 'public',
  JOBS_ENABLED: 'true',
  QUEUE_ENABLED: 'true',
  RATE_LIMIT_FREE: '60',
  RATE_LIMIT_PRO: '300',
  RATE_LIMIT_ENTERPRISE: '2000',
  AWS_SECRETS_MANAGER_ENABLED: 'true',
  AWS_SECRETS_MANAGER_SECRET_ID: 'agenticpay-prod-app-secrets',
};
