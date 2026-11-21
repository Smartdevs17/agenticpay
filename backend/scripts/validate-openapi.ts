#!/usr/bin/env tsx
/**
 * CI check: validates the OpenAPI document before it is fed to the SDK
 * generators — Issue #825. Run with `npm run openapi:validate`.
 *
 * Defaults to `openapi.json`, which is the document the SDKs are generated
 * from. The tsoa output (`swagger.json`) is not included by default: tsoa
 * 7.0.0-alpha.0 emits `$ref`s into `components.schemas` without registering the
 * models themselves, so that file is known to have unresolved references. Pass
 * it explicitly to inspect it:
 *
 *   npx tsx scripts/validate-openapi.ts docs/api/openapi/swagger.json
 *
 * Usage: tsx scripts/validate-openapi.ts [spec.json ...]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateOpenApi } from '../src/lib/openapi-validator.js';

const DEFAULT_SPECS = ['docs/api/openapi/openapi.json'];

const specs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_SPECS;

let failed = false;

for (const specPath of specs) {
  const absolute = resolve(process.cwd(), specPath);
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (err) {
    console.error(`✖ ${specPath}: could not read or parse — ${(err as Error).message}`);
    failed = true;
    continue;
  }

  const result = validateOpenApi(parsed);

  const { version, paths, operations, schemas } = result.stats;
  console.log(`\n${specPath}  (OpenAPI ${version ?? 'unknown'})`);
  console.log(`  ${paths} paths, ${operations} operations, ${schemas} schemas`);

  for (const warning of result.warnings) {
    console.warn(`  ⚠ ${warning.message}${warning.location ? ` (${warning.location})` : ''}`);
  }

  if (result.valid) {
    console.log('  ✔ valid');
    continue;
  }

  failed = true;
  for (const issue of result.errors) {
    console.error(`  ✖ ${issue.message}${issue.location ? ` (${issue.location})` : ''}`);
  }
}

if (failed) {
  console.error('\nOpenAPI validation failed.');
  process.exit(1);
}

console.log('\nAll OpenAPI documents are valid.');
