#!/usr/bin/env node
import { generateApiHooks } from './generator.js';
import { startWatcher } from './watcher.js';

async function main() {
  const args = process.argv.slice(2);
  const configPath = args.find((a) => !a.startsWith('-')) || 'backend/docs/api/openapi/openapi.yaml';
  const watchMode = args.includes('--watch');
  const outDir =
    args.find((_, i) => args[i - 1] === '--out') || 'frontend/src/generated';

  const config = {
    specPath: configPath,
    outDir,
    reactQueryPath: '@tanstack/react-query',
    clientPath: './client',
    endpointOverrides: [],
    authHeader: 'Authorization',
    authScheme: 'Bearer',
  };

  if (watchMode) {
    console.log(`[api-hooks-generator] Watching ${configPath} for changes...`);
    await startWatcher(config, () => generateApiHooks(config));
  } else {
    console.log(`[api-hooks-generator] Generating from ${configPath}...`);
    await generateApiHooks(config);
    console.log(`[api-hooks-generator] Generated to ${outDir}`);
  }
}

main().catch((err) => {
  console.error('[api-hooks-generator] Fatal error:', err);
  process.exit(1);
});
