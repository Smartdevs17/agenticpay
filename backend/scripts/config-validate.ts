#!/usr/bin/env tsx
/**
 * CI check: validates that every environment's config (base process.env
 * schema + per-environment overrides in src/config/environments/*.ts) parses
 * cleanly against the Zod schemas. Run with `npm run config:validate`.
 */
import { z } from 'zod';
import { developmentOverrides } from '../src/config/environments/development.js';
import { stagingOverrides } from '../src/config/environments/staging.js';
import { productionOverrides } from '../src/config/environments/production.js';
import { environmentOverridesSchema, type EnvironmentName } from '../src/config/environments/types.js';

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
  AWS_SECRETS_MANAGER_ENABLED: z.enum(['true', 'false']).default('false'),
  AWS_SECRETS_MANAGER_SECRET_ID: z.string().default(''),
});

const ENVIRONMENTS: Record<EnvironmentName, unknown> = {
  development: developmentOverrides,
  staging: stagingOverrides,
  production: productionOverrides,
};

let failed = false;

for (const [name, overrides] of Object.entries(ENVIRONMENTS)) {
  const overrideResult = environmentOverridesSchema.safeParse(overrides);
  if (!overrideResult.success) {
    failed = true;
    console.error(`[config:validate] ${name}: override file failed schema validation`);
    console.error(overrideResult.error.flatten().fieldErrors);
    continue;
  }

  const merged = { ...overrideResult.data, NODE_ENV: name };
  const result = envSchema.safeParse(merged);
  if (!result.success) {
    failed = true;
    console.error(`[config:validate] ${name}: merged config failed schema validation`);
    console.error(result.error.flatten().fieldErrors);
    continue;
  }

  console.log(`[config:validate] ${name}: OK`);
}

if (failed) {
  console.error('\nConfig validation failed.');
  process.exit(1);
}

console.log('\nAll environment configs are valid.');
