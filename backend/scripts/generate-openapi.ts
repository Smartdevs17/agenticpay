#!/usr/bin/env npx tsx
/**
 * OpenAPI Specification Generator for AgenticPay
 * Generates OpenAPI spec from Zod schemas + route registry, Postman collection, and SDK stubs.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createOpenAPIGenerator } from '../src/lib/openapi-generator.js';
import { registerRoutesFromRegistry } from '../src/lib/openapi-registry.js';
import { API_OPERATIONS } from '@agenticpay/api-spec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..');

interface GeneratorConfig {
  title: string;
  version: string;
  description: string;
  baseUrl: string;
  outputDir: string;
  generateSDKs: boolean;
  sdkLanguages: string[];
}

async function loadConfig(): Promise<GeneratorConfig> {
  const configPath = path.join(BACKEND_ROOT, 'openapi.config.json');

  const defaultConfig: GeneratorConfig = {
    title: 'AgenticPay API',
    version: '1.0.0',
    description: 'AI-Powered Payment Infrastructure for Autonomous Agents',
    baseUrl: 'http://localhost:3001/api/v1',
    outputDir: path.join(BACKEND_ROOT, 'docs', 'api'),
    generateSDKs: true,
    sdkLanguages: ['typescript', 'python', 'go'],
  };

  if (fs.existsSync(configPath)) {
    const custom = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Partial<GeneratorConfig>;
    return { ...defaultConfig, ...custom };
  }

  return defaultConfig;
}

async function generateOpenAPISpec(config: GeneratorConfig): Promise<void> {
  console.log('Generating OpenAPI specification from Zod schemas and route registry...');

  const generator = createOpenAPIGenerator({
    title: config.title,
    version: config.version,
    description: config.description,
    baseUrl: config.baseUrl,
  });

  registerRoutesFromRegistry(generator);

  for (const operation of API_OPERATIONS) {
    generator.registerPath(operation.method, operation.path.replace(/^\/api\/v1/, ''), {
      tags: operation.tags,
      summary: operation.summary,
      deprecated: operation.deprecated,
      responses: Object.fromEntries(
        Object.keys(operation.responses).map((status) => [
          status,
          {
            description: status.startsWith('2') ? 'Successful response' : 'Error response',
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
        ])
      ),
      ...(operation.sunset
        ? {
            parameters: [
              {
                name: 'Sunset',
                in: 'header',
                description: `Endpoint sunset date: ${operation.sunset}`,
                required: false,
                schema: { type: 'string', format: 'date-time' },
              },
            ],
          }
        : {}),
    });
  }

  const specDir = path.join(config.outputDir, 'openapi');
  fs.mkdirSync(specDir, { recursive: true });

  generator.saveToFile(path.join(specDir, 'openapi.json'), 'json');
  generator.saveToFile(path.join(specDir, 'openapi.yaml'), 'yaml');

  console.log(`  openapi.json -> ${path.join(specDir, 'openapi.json')}`);
  console.log(`  openapi.yaml -> ${path.join(specDir, 'openapi.yaml')}`);
}

async function generatePostmanCollection(config: GeneratorConfig): Promise<void> {
  const specPath = path.join(config.outputDir, 'openapi/openapi.json');
  if (!fs.existsSync(specPath)) return;

  const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8')) as {
    paths?: Record<string, Record<string, { summary?: string }>>;
  };

  const items: object[] = [];
  for (const [routePath, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (method === 'parameters') continue;
      items.push({
        name: operation.summary ?? `${method.toUpperCase()} ${routePath}`,
        request: {
          method: method.toUpperCase(),
          header: [{ key: 'Authorization', value: 'Bearer {{token}}' }],
          url: {
            raw: `${config.baseUrl}${routePath.replace(/\{([^}]+)\}/g, ':$1')}`,
            host: ['{{baseUrl}}'],
            path: routePath.split('/').filter(Boolean),
          },
        },
      });
    }
  }

  const collection = {
    info: {
      name: 'AgenticPay API',
      description: 'Auto-generated from OpenAPI spec',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{token}}', type: 'string' }],
    },
    variable: [
      { key: 'baseUrl', value: config.baseUrl },
      { key: 'token', value: '' },
    ],
    item: items,
  };

  const postmanDir = path.join(config.outputDir, 'postman');
  fs.mkdirSync(postmanDir, { recursive: true });
  fs.writeFileSync(
    path.join(postmanDir, 'AgenticPay-API.postman_collection.json'),
    JSON.stringify(collection, null, 2)
  );
  console.log(`  Postman collection -> ${postmanDir}`);
}

async function generateTypeScriptSdkFromSpec(config: GeneratorConfig): Promise<void> {
  const specPath = path.join(config.outputDir, 'openapi/openapi.json');
  const sdkDir = path.join(config.outputDir, 'sdks/typescript');
  fs.mkdirSync(sdkDir, { recursive: true });

  // openapi-typescript generates types; openapi-fetch client is lightweight
  const typesOut = path.join(sdkDir, 'schema.d.ts');
  try {
    const { execSync } = await import('child_process');
    execSync(
      `npx openapi-typescript "${specPath}" -o "${typesOut}"`,
      { stdio: 'inherit', cwd: BACKEND_ROOT }
    );
  } catch {
    console.warn('  openapi-typescript not available; writing minimal SDK client');
    fs.writeFileSync(
      path.join(sdkDir, 'client.ts'),
      `/** Auto-generated AgenticPay SDK — run npm run openapi:generate to refresh */\n` +
        `export type { paths } from './schema.js';\n`
    );
  }

  const client = `/**
 * AgenticPay TypeScript SDK (generated)
 * @see ${config.baseUrl}
 */
import createClient from 'openapi-fetch';
import type { paths } from './schema.js';

export function createAgenticPayClient(token: string, baseUrl = '${config.baseUrl}') {
  return createClient<paths>({
    baseUrl,
    headers: { Authorization: \`Bearer \${token}\` },
  });
}

export default createAgenticPayClient;
`;
  fs.writeFileSync(path.join(sdkDir, 'client.ts'), client);
  console.log(`  TypeScript SDK -> ${sdkDir}`);
}

async function generateSDKs(config: GeneratorConfig): Promise<void> {
  if (!config.generateSDKs) return;
  await generateTypeScriptSdkFromSpec(config);
}

async function writeExplorerHtml(config: GeneratorConfig): Promise<void> {
  const explorerDir = path.join(config.outputDir, 'explorer');
  fs.mkdirSync(explorerDir, { recursive: true });
  fs.writeFileSync(
    path.join(explorerDir, 'index.html'),
    `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/docs"/></head>
<body><a href="/docs">AgenticPay API Docs</a></body></html>`
  );
}

export async function main(): Promise<void> {
  const config = await loadConfig();
  console.log('OpenAPI Generator — AgenticPay');
  console.log(`Version: ${config.version}\n`);

  await generateOpenAPISpec(config);
  await generatePostmanCollection(config);
  await generateSDKs(config);
  await writeExplorerHtml(config);

  console.log('\nGeneration complete.');
  console.log(`Documentation: ${config.outputDir}`);
  console.log('Live Swagger UI: http://localhost:3001/docs');
}

main().catch((error) => {
  console.error('Generation failed:', error);
  process.exit(1);
});
