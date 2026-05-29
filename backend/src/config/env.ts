import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/agenticpay'),
  PORT: z.coerce.number().default(3001),
  CORS_ALLOWED_ORIGINS: z.string().default('*'),
  STELLAR_NETWORK: z.enum(['testnet', 'public']).default('testnet'),
  OPENAI_API_KEY: z.string({
    required_error: 'OPENAI_API_KEY is required for verification and invoicing services',
  }).min(1, 'OPENAI_API_KEY cannot be empty'),
  JOBS_ENABLED: z.coerce.string().transform((val) => val !== 'false').default('true'),
  QUEUE_ENABLED: z.coerce.string().transform((val) => val !== 'false').default('true'),
  RATE_LIMIT_FREE: z.coerce.number().default(100),
  RATE_LIMIT_PRO: z.coerce.number().default(300),
  RATE_LIMIT_ENTERPRISE: z.coerce.number().default(1000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  IP_ALLOWLIST: z.string().default(''),
  IP_ALLOWLIST_ENABLED: z.coerce.string().transform((val) => val === 'true').default('false'),
  IP_ALLOWLIST_BYPASS_ENABLED: z.coerce.string().transform((val) => val === 'true').default('false'),
  IP_ALLOWLIST_BYPASS_EXPIRY_MS: z.coerce.number().default(30 * 60 * 1000),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PUBLISHABLE_KEY: z.string().default(''),
  REDIS_URL: z.string().default(''),
  REDIS_ENABLED: z.coerce.string().transform((val) => val === 'true').default('false'),
  CACHE_WARMING_ENABLED: z.coerce.string().transform((val) => val === 'true').default('false'),
  DB_QUERY_LOGGING_ENABLED: z.coerce.string().transform((val) => val === 'true').default('false'),
  DB_SLOW_QUERY_THRESHOLD_MS: z.coerce.number().default(100),
  // Transaction monitor (Issue #402)
  TX_MONITOR_POLL_MS: z.coerce.number().default(15_000),
  TX_MONITOR_STUCK_THRESHOLD_MS: z.coerce.number().default(300_000),
  TX_MONITOR_MAX_RETRIES: z.coerce.number().default(3),
  ALERT_WEBHOOK_URL: z.string().default(''),
  // File upload (Issue #401)
  UPLOAD_DIR: z.string().default('./uploads'),
  CLAMD_HOST: z.string().default(''),
  CLAMD_PORT: z.coerce.number().default(3310),
  // Credential rotation (Issue #395)
  CREDENTIAL_ROTATION_CHECK_INTERVAL_MS: z.coerce.number().default(60 * 60 * 1000),
  // Threat detection (Issue #394)
  THREAT_ALERT_WEBHOOK_URL: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

let _config: Env | undefined;

export const validateEnv = (): Env => {
  try {
    _config = envSchema.parse(process.env);
    return _config;
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map((err: z.ZodIssue) => `${err.path.join('.')}: ${err.message}`);
      console.error('❌ Invalid environment variables:');
      missingVars.forEach((msg: string) => console.error(`   - ${msg}`));
      process.exit(1);
    }
    throw error;
  }
};

export const config = (): Env => {
  if (!_config) {
    return validateEnv();
  }
  return _config;
};
