#!/usr/bin/env tsx
// SDK Generator CLI — Issue #523

import { readFileSync } from 'fs';
import { join } from 'path';
import { SDKGenerator, GeneratorConfig } from './generator';

interface CLIArgs {
  config?: string;
  lang?: string;
  output?: string;
  apiBaseUrl?: string;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const result: CLIArgs = {};

  for (const arg of args) {
    if (arg.startsWith('--config=')) {
      result.config = arg.split('=')[1];
    } else if (arg.startsWith('--lang=')) {
      result.lang = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      result.output = arg.split('=')[1];
    } else if (arg.startsWith('--api-base-url=')) {
      result.apiBaseUrl = arg.split('=')[1];
    }
  }

  return result;
}

function loadConfig(configPath: string): GeneratorConfig {
  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);

    return {
      openapi: config.openapi || 'docs/api/openapi/openapi.json',
      outputDir: config.outputDir || 'dist/sdk',
      packageName: config.packageName || 'agenticpay',
      packageVersion: config.packageVersion || '0.1.0',
      apiBaseUrl: config.apiBaseUrl || 'https://api.agenticpay.com',
      supportedLanguages: config.supportedLanguages || ['typescript', 'python', 'go', 'rust'],
    };
  } catch (err) {
    console.error(`[sdk-gen] Failed to load config: ${err}`);
    process.exit(1);
  }
}

async function main() {
  const cliArgs = parseArgs();

  if (!cliArgs.config && !cliArgs.lang) {
    console.log(`
SDK Generator for AgenticPay

Usage: agenticpay-sdk-gen [options]

Options:
  --config=<path>           Path to config file (default: openapi.config.json)
  --lang=<lang>             Language: typescript, python, go, rust, or all
  --output=<dir>            Output directory (default: dist/sdk)
  --api-base-url=<url>      API base URL (default: https://api.agenticpay.com)

Examples:
  agenticpay-sdk-gen --config openapi.config.json
  agenticpay-sdk-gen --lang typescript --output ./sdk-ts
  agenticpay-sdk-gen --config config.json --lang python

Configuration file format (openapi.config.json):
{
  "openapi": "docs/api/openapi/openapi.json",
  "outputDir": "dist/sdk",
  "packageName": "agenticpay",
  "packageVersion": "0.1.0",
  "apiBaseUrl": "https://api.agenticpay.com",
  "supportedLanguages": ["typescript", "python", "go", "rust"]
}
`);
    process.exit(0);
  }

  try {
    const configPath = cliArgs.config || 'openapi.config.json';
    let config = loadConfig(configPath);

    // Override with CLI args
    if (cliArgs.output) config.outputDir = cliArgs.output;
    if (cliArgs.apiBaseUrl) config.apiBaseUrl = cliArgs.apiBaseUrl;

    // If specific language requested, generate only that
    if (cliArgs.lang && cliArgs.lang !== 'all') {
      config.supportedLanguages = [cliArgs.lang];
    }

    const generator = new SDKGenerator(config);
    await generator.generate();

    console.log(`[sdk-gen] SDKs generated successfully to ${config.outputDir}`);
    process.exit(0);
  } catch (err) {
    console.error(`[sdk-gen] Generation failed: ${err}`);
    process.exit(1);
  }
}

main();
