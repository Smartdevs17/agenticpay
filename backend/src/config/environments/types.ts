import { z } from 'zod';

/**
 * Per-environment overrides. Every field is optional — an environment file only
 * needs to declare values that differ from the shared defaults in `config.ts`.
 * Values still pass through the base env schema validation after merging.
 */
export const environmentOverridesSchema = z.object({
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  STELLAR_NETWORK: z.enum(['testnet', 'public']).optional(),
  JOBS_ENABLED: z.enum(['true', 'false']).optional(),
  QUEUE_ENABLED: z.enum(['true', 'false']).optional(),
  RATE_LIMIT_FREE: z.string().optional(),
  RATE_LIMIT_PRO: z.string().optional(),
  RATE_LIMIT_ENTERPRISE: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.string().optional(),
  COMPRESSION_THRESHOLD: z.string().optional(),
  AWS_SECRETS_MANAGER_ENABLED: z.enum(['true', 'false']).optional(),
  AWS_SECRETS_MANAGER_SECRET_ID: z.string().optional(),
});

export type EnvironmentOverrides = z.infer<typeof environmentOverridesSchema>;
export type EnvironmentName = 'development' | 'staging' | 'production';
