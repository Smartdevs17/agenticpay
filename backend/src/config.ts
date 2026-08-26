import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

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
} as const;

export type Config = typeof config;
