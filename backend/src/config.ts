import dotenv from 'dotenv';
import { z } from 'zod';
import { applyEnvironmentFileDefaults, refreshSecretsManagerConfig, resolveEnvironmentName } from './config/environments/index.js';

dotenv.config();

// Layer in environment-specific defaults (backend/src/config/environments/*.ts)
// before validating. Real process.env values always win over these defaults.
const activeEnvironment = applyEnvironmentFileDefaults();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.string().default('3001'),
  CORS_ALLOWED_ORIGINS: z.string().default('*'),
  JOBS_ENABLED: z.enum(['true', 'false']).default('true'),
  QUEUE_ENABLED: z.enum(['true', 'false']).default('true'),
  STELLAR_NETWORK: z.enum(['testnet', 'public']).default('testnet'),
  RATE_LIMIT_FREE: z.string().default('100'),
  RATE_LIMIT_PRO: z.string().default('300'),
  RATE_LIMIT_ENTERPRISE: z.string().default('1000'),
  RATE_LIMIT_WINDOW_MS: z.string().default(String(15 * 60 * 1000)),
  COMPRESSION_THRESHOLD: z.string().default('1024'),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  AWS_SECRETS_MANAGER_ENABLED: z.enum(['true', 'false']).default('false'),
  AWS_SECRETS_MANAGER_SECRET_ID: z.string().default(''),
});

function buildConfig() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  const env = parsed.data;

  return {
    env: env.NODE_ENV,
    environment: activeEnvironment,
    isDev: env.NODE_ENV === 'development',
    isStaging: env.NODE_ENV === 'staging',
    isProd: env.NODE_ENV === 'production',
    server: {
      port: Number(env.PORT),
    },
    cors: {
      allowedOrigins: env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()),
    },
    jobs: {
      enabled: env.JOBS_ENABLED === 'true',
    },
    queue: {
      enabled: env.QUEUE_ENABLED === 'true',
    },
    stellar: {
      network: env.STELLAR_NETWORK,
    },
    rateLimit: {
      free: Number(env.RATE_LIMIT_FREE),
      pro: Number(env.RATE_LIMIT_PRO),
      enterprise: Number(env.RATE_LIMIT_ENTERPRISE),
      windowMs: Number(env.RATE_LIMIT_WINDOW_MS),
    },
    compression: {
      threshold: Number(env.COMPRESSION_THRESHOLD),
    },
    vapidKeys: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
      ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
      : null,
    secretsManager: {
      enabled: env.AWS_SECRETS_MANAGER_ENABLED === 'true',
      secretId: env.AWS_SECRETS_MANAGER_SECRET_ID || null,
    },
  };
}

export const config = buildConfig();

export type Config = typeof config;

/**
 * Runtime config refresh (acceptance criteria: "runtime config refresh
 * capability"): re-pulls secrets from AWS Secrets Manager (if configured),
 * re-validates process.env with the same Zod schema, and mutates the
 * exported `config` object in place so existing imports observe the update.
 */
export async function refreshConfig(): Promise<Config> {
  await refreshSecretsManagerConfig();
  const next = buildConfig();
  Object.assign(config, next);
  return config;
}

export { resolveEnvironmentName };
