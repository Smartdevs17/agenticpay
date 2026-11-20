#!/usr/bin/env node
/**
 * Generates typed SDK clients from the backend OpenAPI document (#1496).
 *
 *   node scripts/sdk/generate-sdk.mjs <typescript|python|go>
 *
 * The settings for each language come from backend/openapi-generator.config.json
 * (`generators.<lang>`), so that file stays the single source of truth. The
 * generator itself runs from the pinned openapi-generator-cli Docker image, which
 * needs no local Java install and matches CI.
 *
 * Use --print to show the docker command without running it.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Must match `openapiGenerator.version` in backend/openapi-generator.config.json. */
export const OPENAPI_GENERATOR_IMAGE = 'openapitools/openapi-generator-cli:v7.0.1';

const CONTAINER_ROOT = '/local';

/**
 * Pure: builds the docker invocation for one language. Throws on unknown languages
 * and on config that the generator cannot represent.
 */
export function buildGeneratorCommand({ lang, config, repoRoot, backendDir, uid, gid }) {
  const generator = config.generators?.[lang];
  if (!generator) {
    const known = Object.keys(config.generators ?? {}).join(', ');
    throw new Error(`no generator configured for "${lang}" (configured: ${known || 'none'})`);
  }

  const specPath = resolve(backendDir, config.openapiGenerator.inputSpec);
  const outputPath = resolve(backendDir, generator.outputDir);
  const toContainer = (hostPath) => {
    const rel = relative(repoRoot, hostPath);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`path ${hostPath} is outside the repository and cannot be mounted`);
    }
    return posix.join(CONTAINER_ROOT, ...rel.split(sep));
  };

  // The top-level openapiGenerator block holds the full typescript-axios options.
  // Per-language entries override it, and only apply to the generator it describes.
  const baseProperties =
    generator.generatorName === config.openapiGenerator.generatorName
      ? (config.openapiGenerator.additionalProperties ?? {})
      : {};
  const properties = toPairs({ ...baseProperties, ...(generator.additionalProperties ?? {}) }, 'additional property');
  const globals = toPairs(
    generator.generatorName === config.openapiGenerator.generatorName
      ? (config.openapiGenerator.globalProperties ?? {})
      : {},
    'global property',
  );

  const args = [
    'run',
    '--rm',
    ...(uid !== undefined && gid !== undefined ? ['--user', `${uid}:${gid}`] : []),
    '--volume',
    `${repoRoot}:${CONTAINER_ROOT}`,
    OPENAPI_GENERATOR_IMAGE,
    'generate',
    '--input-spec',
    toContainer(specPath),
    '--generator-name',
    generator.generatorName,
    '--output',
    toContainer(outputPath),
  ];
  if (properties.length > 0) args.push('--additional-properties', properties.join(','));
  if (globals.length > 0) args.push('--global-property', globals.join(','));

  return { command: 'docker', args };
}

function toPairs(values, label) {
  return Object.entries(values).map(([key, value]) => {
    const text = String(value);
    if (text.includes(',')) throw new Error(`${label} "${key}" must not contain a comma`);
    return `${key}=${text}`;
  });
}

function main(argv) {
  const print = argv.includes('--print');
  const [lang] = argv.filter((arg) => !arg.startsWith('--'));
  if (!lang) {
    console.error('usage: node scripts/sdk/generate-sdk.mjs <language> [--print]');
    return 2;
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const backendDir = resolve(repoRoot, 'backend');
  const config = JSON.parse(readFileSync(resolve(backendDir, 'openapi-generator.config.json'), 'utf8'));

  const { command, args } = buildGeneratorCommand({
    lang,
    config,
    repoRoot,
    backendDir,
    uid: process.getuid?.(),
    gid: process.getgid?.(),
  });

  if (print) {
    console.log([command, ...args].join(' '));
    return 0;
  }

  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`failed to start docker: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
