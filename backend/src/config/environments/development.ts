import type { EnvironmentOverrides } from './types.js';

export const developmentOverrides: EnvironmentOverrides = {
  CORS_ALLOWED_ORIGINS: '*',
  STELLAR_NETWORK: 'testnet',
  JOBS_ENABLED: 'true',
  QUEUE_ENABLED: 'true',
  AWS_SECRETS_MANAGER_ENABLED: 'false',
};
