import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
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
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/agenticpay'),
  PGBOUNCER_ENABLED: z.enum(['true', 'false']).default('false'),
  DB_POOL_MIN: z.string().default('2'),
  DB_POOL_MAX: z.string().default('10'),
  DB_POOL_IDLE_TIMEOUT_MS: z.string().default('10000'),
  DB_POOL_ACQUIRE_TIMEOUT_MS: z.string().default('30000'),
  DB_POOL_MAX_USES: z.string().default('7500'),
  DB_STATEMENT_TIMEOUT_MS: z.string().default('30000'),
  HSTS_MAX_AGE_SECONDS: z.string().default('31536000'),
  PERMISSIONS_POLICY: z
    .string()
    .default('camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), interest-cohort=()'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
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
  db: {
    url: env.DATABASE_URL,
    pgbouncer: {
      enabled: env.PGBOUNCER_ENABLED === 'true',
    },
    pool: {
      min: Number(env.DB_POOL_MIN),
      max: Number(env.DB_POOL_MAX),
      idleTimeoutMs: Number(env.DB_POOL_IDLE_TIMEOUT_MS),
      acquireTimeoutMs: Number(env.DB_POOL_ACQUIRE_TIMEOUT_MS),
      maxUses: Number(env.DB_POOL_MAX_USES),
      statementTimeoutMs: Number(env.DB_STATEMENT_TIMEOUT_MS),
    },
  },
  security: {
    hsts: {
      maxAge: Number(env.HSTS_MAX_AGE_SECONDS),
      includeSubDomains: true,
      preload: true,
    },
    permissionsPolicy: env.PERMISSIONS_POLICY,
  },
} as const;

export type Config = typeof config;
