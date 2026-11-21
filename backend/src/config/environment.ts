/**
 * The single configuration loader for the backend (Issue #1422).
 *
 * Every setting is declared once in `envSchema` and resolved in one order:
 *
 *   schema default  <  environment file (environments/<NODE_ENV>.ts)  <  process.env
 *
 * `config()` returns the validated flat env; `toAppConfig()` derives the
 * grouped view that `src/config.ts` exports. Nothing else in the backend should
 * read `process.env` for settings declared here.
 */
import { z } from 'zod';
import dotenv from 'dotenv';
import { getEnvironmentOverrides } from './environments/index.js';

dotenv.config();

/** `'false'` disables, anything else enables (unset falls back to the default). */
const enabledUnlessFalse = (fallback: 'true' | 'false') =>
  z.coerce
    .string()
    .default(fallback)
    .transform((value) => value !== 'false');

/** Only `'true'` enables. */
const enabledOnlyIfTrue = (fallback: 'true' | 'false') =>
  z.coerce
    .string()
    .default(fallback)
    .transform((value) => value === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_LEVELS: z.string().default(''),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/agenticpay'),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ALLOWED_ORIGINS: z.string().default('*'),
  STELLAR_NETWORK: z.enum(['testnet', 'public']).default('testnet'),
  OPENAI_API_KEY: z.string().default('mock-openai-key'),
  JOBS_ENABLED: enabledUnlessFalse('true'),
  QUEUE_ENABLED: enabledUnlessFalse('true'),
  RATE_LIMIT_FREE: z.coerce.number().int().nonnegative().default(100),
  RATE_LIMIT_PRO: z.coerce.number().int().nonnegative().default(300),
  RATE_LIMIT_ENTERPRISE: z.coerce.number().int().nonnegative().default(1000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  COMPRESSION_THRESHOLD: z.coerce.number().int().nonnegative().default(1024),
  IP_ALLOWLIST: z.string().default(''),
  IP_ALLOWLIST_ENABLED: enabledOnlyIfTrue('false'),
  IP_ALLOWLIST_BYPASS_ENABLED: enabledOnlyIfTrue('false'),
  IP_ALLOWLIST_BYPASS_EXPIRY_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PUBLISHABLE_KEY: z.string().default(''),
  REDIS_URL: z.string().default(''),
  REDIS_ENABLED: enabledOnlyIfTrue('false'),
  CACHE_WARMING_ENABLED: enabledOnlyIfTrue('false'),
  DB_QUERY_LOGGING_ENABLED: enabledOnlyIfTrue('false'),
  DB_SLOW_QUERY_THRESHOLD_MS: z.coerce.number().nonnegative().default(100),
  // Transaction monitor (Issue #402)
  TX_MONITOR_POLL_MS: z.coerce.number().int().positive().default(15_000),
  TX_MONITOR_STUCK_THRESHOLD_MS: z.coerce.number().int().positive().default(300_000),
  TX_MONITOR_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  ALERT_WEBHOOK_URL: z.string().default(''),
  // File upload (Issue #401)
  UPLOAD_DIR: z.string().default('./uploads'),
  CLAMD_HOST: z.string().default(''),
  CLAMD_PORT: z.coerce.number().int().positive().default(3310),
  // Credential rotation (Issue #395)
  CREDENTIAL_ROTATION_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  // Threat detection (Issue #394)
  THREAT_ALERT_WEBHOOK_URL: z.string().default(''),
  // AWS Secrets Manager (environments/secrets-manager.ts)
  AWS_SECRETS_MANAGER_ENABLED: enabledOnlyIfTrue('false'),
  AWS_SECRETS_MANAGER_SECRET_ID: z.string().default(''),
  AWS_REGION: z.string().default('us-east-1'),
});

export type Env = z.infer<typeof envSchema>;

export type EnvSource = Record<string, string | undefined>;

export type ParseEnvResult =
  | { success: true; data: Env }
  | { success: false; issues: string[] };

/**
 * Environment-file values for the source's NODE_ENV, underneath whatever the
 * source already sets. Empty strings count as "set" so an operator can blank a
 * value on purpose. Does not mutate the source.
 */
export function withEnvironmentDefaults(source: EnvSource): EnvSource {
  const merged: EnvSource = {};
  for (const [key, value] of Object.entries(getEnvironmentOverrides(source.NODE_ENV))) {
    if (value !== undefined) merged[key] = value;
  }
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/**
 * Validates a source without side effects. Issues name the variable and the
 * problem but never echo its value, so they are safe to log.
 */
export function parseEnv(source: EnvSource = process.env): ParseEnvResult {
  const result = envSchema.safeParse(withEnvironmentDefaults(source));
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    issues: result.error.issues.map((issue) => `${issue.path.join('.')}: ${describeIssue(issue)}`),
  };
}

/** Zod's enum message quotes the rejected value; list the allowed ones instead. */
function describeIssue(issue: z.ZodIssue): string {
  if (issue.code === z.ZodIssueCode.invalid_enum_value) {
    return `expected one of ${issue.options.join(', ')}`;
  }
  return issue.message;
}

let cached: Env | undefined;

/**
 * Validates `process.env` and caches the result. On invalid configuration it
 * logs every issue, exits the process with status 1, and throws (so code after
 * a mocked `process.exit` in tests does not run with bad settings).
 */
export const validateEnv = (): Env => {
  const result = parseEnv(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    result.issues.forEach((issue) => console.error(`   - ${issue}`));
    process.exit(1);
    throw new Error(`Invalid environment configuration: ${result.issues.join('; ')}`);
  }
  cached = result.data;
  return cached;
};

/** The validated env, loaded on first use. */
export const config = (): Env => cached ?? validateEnv();

/** Forget the cached env so the next `config()` re-reads `process.env`. For tests. */
export const clearEnvCache = (): void => {
  cached = undefined;
};

/** The grouped, typed view of the env used across the app. */
export function toAppConfig(env: Env) {
  return {
    env: env.NODE_ENV,
    isDev: env.NODE_ENV === 'development',
    isTest: env.NODE_ENV === 'test',
    isStaging: env.NODE_ENV === 'staging',
    isProd: env.NODE_ENV === 'production',
    server: {
      port: env.PORT,
    },
    cors: {
      allowedOrigins: env.CORS_ALLOWED_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    },
    jobs: {
      enabled: env.JOBS_ENABLED,
    },
    queue: {
      enabled: env.QUEUE_ENABLED,
    },
    stellar: {
      network: env.STELLAR_NETWORK,
    },
    rateLimit: {
      free: env.RATE_LIMIT_FREE,
      pro: env.RATE_LIMIT_PRO,
      enterprise: env.RATE_LIMIT_ENTERPRISE,
      windowMs: env.RATE_LIMIT_WINDOW_MS,
    },
    compression: {
      threshold: env.COMPRESSION_THRESHOLD,
    },
    vapidKeys:
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
        : null,
  } as const;
}

export type AppConfig = ReturnType<typeof toAppConfig>;
