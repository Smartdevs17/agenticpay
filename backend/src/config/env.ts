import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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
