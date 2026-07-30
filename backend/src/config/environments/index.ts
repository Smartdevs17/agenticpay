import { developmentOverrides } from './development.js';
import { stagingOverrides } from './staging.js';
import { productionOverrides } from './production.js';
import { loadSecretsManagerOverrides } from './secrets-manager.js';
import type { EnvironmentName, EnvironmentOverrides } from './types.js';

export * from './types.js';
export { loadSecretsManagerOverrides };

const ENVIRONMENT_CONFIGS: Record<EnvironmentName, EnvironmentOverrides> = {
  development: developmentOverrides,
  staging: stagingOverrides,
  production: productionOverrides,
};

export function resolveEnvironmentName(nodeEnv: string | undefined): EnvironmentName {
  if (nodeEnv === 'staging') return 'staging';
  if (nodeEnv === 'production') return 'production';
  return 'development';
}

/** Environment file values, without mutating process.env. */
export function getEnvironmentOverrides(nodeEnv: string | undefined): EnvironmentOverrides {
  return ENVIRONMENT_CONFIGS[resolveEnvironmentName(nodeEnv)];
}

/**
 * Applies environment-file defaults onto process.env, without clobbering
 * variables the process was actually started with. Synchronous so it can run
 * at config module load time. Precedence: environment file < process.env.
 */
export function applyEnvironmentFileDefaults(): EnvironmentName {
  const envName = resolveEnvironmentName(process.env.NODE_ENV);
  const overrides = ENVIRONMENT_CONFIGS[envName];

  for (const [key, value] of Object.entries(overrides)) {
    if (process.env[key] === undefined && value !== undefined) {
      process.env[key] = value;
    }
  }

  return envName;
}

/**
 * Fetches secrets from AWS Secrets Manager (when configured) and applies them
 * onto process.env, overriding any existing value. Async — call explicitly at
 * bootstrap and whenever a runtime secret refresh is needed; not run
 * automatically at config load time.
 */
export async function refreshSecretsManagerConfig(): Promise<Record<string, string> | null> {
  const secretsEnabled = process.env.AWS_SECRETS_MANAGER_ENABLED === 'true';
  const secretId = process.env.AWS_SECRETS_MANAGER_SECRET_ID;
  if (!secretsEnabled || !secretId) return null;

  const secrets = await loadSecretsManagerOverrides(secretId);
  for (const [key, value] of Object.entries(secrets)) {
    process.env[key] = value;
  }
  return secrets;
}
