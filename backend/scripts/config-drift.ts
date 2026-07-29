#!/usr/bin/env tsx
/**
 * CI check: detects unintended config drift between environments.
 *  - Flags production/staging inheriting risky development defaults
 *    (wildcard CORS, secrets manager disabled).
 *  - Prints a key-by-key comparison table across dev/staging/prod so
 *    reviewers can see exactly what differs.
 * Run with `npm run config:drift`.
 */
import { developmentOverrides } from '../src/config/environments/development.js';
import { stagingOverrides } from '../src/config/environments/staging.js';
import { productionOverrides } from '../src/config/environments/production.js';
import type { EnvironmentOverrides } from '../src/config/environments/types.js';

const ENVIRONMENTS: Record<string, EnvironmentOverrides> = {
  development: developmentOverrides,
  staging: stagingOverrides,
  production: productionOverrides,
};

const allKeys = Array.from(
  new Set(Object.values(ENVIRONMENTS).flatMap((overrides) => Object.keys(overrides))),
).sort();

console.log('Config comparison across environments\n');
console.log(['key', ...Object.keys(ENVIRONMENTS)].join(' | '));
for (const key of allKeys) {
  const row = [key, ...Object.values(ENVIRONMENTS).map((overrides) => String((overrides as Record<string, unknown>)[key] ?? '—'))];
  console.log(row.join(' | '));
}

const violations: string[] = [];

if (productionOverrides.CORS_ALLOWED_ORIGINS === '*') {
  violations.push('production: CORS_ALLOWED_ORIGINS must not be wildcard "*"');
}
if (stagingOverrides.CORS_ALLOWED_ORIGINS === '*') {
  violations.push('staging: CORS_ALLOWED_ORIGINS must not be wildcard "*"');
}
if (productionOverrides.STELLAR_NETWORK !== 'public') {
  violations.push('production: STELLAR_NETWORK must be "public"');
}
if (productionOverrides.AWS_SECRETS_MANAGER_ENABLED !== 'true') {
  violations.push('production: AWS_SECRETS_MANAGER_ENABLED must be "true"');
}
if (stagingOverrides.AWS_SECRETS_MANAGER_ENABLED !== 'true') {
  violations.push('staging: AWS_SECRETS_MANAGER_ENABLED must be "true"');
}
if (
  productionOverrides.AWS_SECRETS_MANAGER_SECRET_ID &&
  productionOverrides.AWS_SECRETS_MANAGER_SECRET_ID === stagingOverrides.AWS_SECRETS_MANAGER_SECRET_ID
) {
  violations.push('production and staging must not share the same AWS_SECRETS_MANAGER_SECRET_ID');
}

if (violations.length > 0) {
  console.error('\nConfig drift violations detected:');
  violations.forEach((v) => console.error(`  - ${v}`));
  process.exit(1);
}

console.log('\nNo config drift violations detected.');
