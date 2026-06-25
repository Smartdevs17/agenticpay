import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { GeneratorConfig, ParsedEndpoint, EndpointOverride } from './types.js';

function loadOpenApiSpec(specPath: string): Record<string, unknown> {
  const content = fs.readFileSync(specPath, 'utf-8');
  if (specPath.endsWith('.json')) {
    return JSON.parse(content);
  }
  return parseYaml(content);
}

function parseEndpoints(spec: Record<string, unknown>): ParsedEndpoint[] {
  const endpoints: ParsedEndpoint[] = [];
  const paths = spec.paths as Record<string, Record<string, unknown>>;
  if (!paths) return endpoints;

  for (const [pathStr, methods] of Object.entries(paths)) {
    for (const [method, details] of Object.entries(methods as Record<string, unknown>)) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
      const d = details as Record<string, unknown>;
      endpoints.push({
        path: pathStr,
        method: method.toUpperCase(),
        operationId: (d.operationId as string) || `${method}${pathStr.replace(/\//g, '_').replace(/[{}]/g, '')}`,
        summary: (d.summary as string) || '',
        tags: (d.tags as string[]) || [],
        parameters: [],
        requestBody: null,
        responses: {},
        security: (d.security as Record<string, string[]>[]) || [],
      });
    }
  }
  return endpoints;
}

function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]/g, ' ')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

function operationIdToHookName(operationId: string): string {
  if (operationId.startsWith('get')) {
    const rest = operationId.slice(3);
    return `use${toPascalCase(rest)}`;
  }
  if (operationId.startsWith('create') || operationId.startsWith('update') || operationId.startsWith('delete')) {
    return `use${toPascalCase(operationId)}`;
  }
  return `use${toPascalCase(operationId)}`;
}

function determineHookType(method: string): 'useQuery' | 'useMutation' | 'useInfiniteQuery' {
  if (method === 'GET') {
    return 'useQuery';
  }
  if (method === 'GET' && method.includes('page') || method.includes('cursor')) {
    return 'useInfiniteQuery';
  }
  return 'useMutation';
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function generateEndpointFile(
  endpoint: ParsedEndpoint,
  override?: EndpointOverride,
): string {
  const hookName = override?.customHookName || operationIdToHookName(endpoint.operationId);
  const hookType = determineHookType(endpoint.method);
  const tag = endpoint.tags[0] || 'api';
  const responseType = override?.customResponseType || `${toPascalCase(endpoint.operationId)}Response`;
  const requestType = override?.customRequestType || `${toPascalCase(endpoint.operationId)}Request`;
  const pathParams = endpoint.parameters.filter((p) => p.in === 'path');
  const queryParams = endpoint.parameters.filter((p) => p.in === 'query');
  const hasBody = endpoint.method !== 'GET';

  const lines: string[] = [];

  lines.push('// Auto-generated API hook - do not edit directly');
  lines.push(`// Source: ${endpoint.path} [${endpoint.method}]`);
  lines.push('');
  lines.push("import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';");
  lines.push("import { apiClient } from './client';");
  if (hasBody) {
    lines.push("import { z } from 'zod';");
  }
  lines.push('');

  // Generate Zod schema for request body if present
  if (hasBody) {
    lines.push(`export const ${requestType}Schema = z.object({`);
    lines.push('  // Add field validations here');
    lines.push('});');
    lines.push('');
    lines.push(`export type ${requestType} = z.infer<typeof ${requestType}Schema>;`);
    lines.push('');
  }

  // Generate response type
  lines.push(`export interface ${responseType} {`);
  lines.push('  // Add response fields here');
  lines.push('}');
  lines.push('');

  // Generate API function
  const params: string[] = [];
  if (pathParams.length > 0) {
    params.push(`params: { ${pathParams.map((p) => `${p.name}: ${p.schema.type || 'string'}`).join('; ')} }`);
  }
  if (queryParams.length > 0) {
    params.push(`query?: { ${queryParams.map((p) => `${p.name}${p.required ? '' : '?'}: ${p.schema.type || 'string'}`).join('; ')} }`);
  }
  if (hasBody) {
    params.push(`body?: ${requestType}`);
  }

  const functionParams = params.join(', ');
  const urlTemplate = endpoint.path.replace(/{(\w+)}/g, '${params.$1}');
  const queryStr = queryParams.length > 0 ? '?...query' : '';

  lines.push(`export async function fetch${toPascalCase(endpoint.operationId)}(`);
  lines.push(`  ${functionParams}`);
  lines.push(`): Promise<${responseType}> {`);
  if (endpoint.method === 'GET') {
    lines.push(`  return apiClient.get(\`${urlTemplate}\${queryStr}\`).json();`);
  } else if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
    lines.push(`  return apiClient.${endpoint.method.toLowerCase()}(\`${urlTemplate}\`, { json: body }).json();`);
  } else if (endpoint.method === 'DELETE') {
    lines.push(`  return apiClient.delete(\`${urlTemplate}\`).json();`);
  }
  lines.push('}');
  lines.push('');

  // Generate React Query hook
  const queryKey = `['${tag.toLowerCase()}', '${endpoint.operationId}'${pathParams.length > 0 ? ', params' : ''}${queryParams.length > 0 ? ', query' : ''}]`;

  if (hookType === 'useQuery') {
    lines.push(`export function ${hookName}(`);
    lines.push(`  ${functionParams}${functionParams ? ',' : ''}`);
    lines.push('  options?: Omit<Parameters<typeof useQuery<${responseType}>>[0], "queryKey" | "queryFn">,');
    lines.push(') {');
    lines.push('  return useQuery({');
    lines.push(`    queryKey: ${queryKey},`);
    lines.push(`    queryFn: () => fetch${toPascalCase(endpoint.operationId)}(${[pathParams.length > 0 ? 'params' : '', queryParams.length > 0 ? 'query' : ''].filter(Boolean).join(', ')}),`);
    lines.push('    ...options,');
    lines.push('  });');
    lines.push('}');
  } else {
    lines.push(`export function ${hookName}(`);
    lines.push('  options?: Omit<Parameters<typeof useMutation<${responseType}, Error, ${hasBody ? requestType : 'void'}>>[0], "mutationFn">,');
    lines.push(') {');
    lines.push('  const queryClient = useQueryClient();');
    lines.push('  return useMutation({');
    lines.push(`    mutationFn: (data) => fetch${toPascalCase(endpoint.operationId)}(${[pathParams.length > 0 ? 'params' : '', queryParams.length > 0 ? 'query' : '', 'data'].filter(Boolean).join(', ')}),`);
    lines.push('    ...options,');
    lines.push('  });');
    lines.push('}');
  }

  return lines.join('\n');
}

function generateIndexFile(endpoints: ParsedEndpoint[]): string {
  const lines: string[] = [];
  lines.push('// Auto-generated API hooks index');
  lines.push('');
  for (const ep of endpoints) {
    const safeName = ep.operationId.replace(/[^a-zA-Z0-9_$]/g, '_');
    lines.push(`export { fetch${toPascalCase(ep.operationId)}, ${operationIdToHookName(ep.operationId)} } from './${safeName}';`);
  }
  return lines.join('\n');
}

function generateClientFile(): string {
  return `// Auto-generated API client
import ky from 'ky';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export const apiClient = ky.create({
  prefixUrl: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  hooks: {
    beforeRequest: [
      (request) => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
        if (token) {
          request.headers.set('Authorization', \`Bearer \${token}\`);
        }
      },
    ],
  },
});
`;
}

function generateMswHandlers(endpoints: ParsedEndpoint[]): string {
  const lines: string[] = [];
  lines.push('// Auto-generated MSW handlers for testing');
  lines.push("import { http, HttpResponse } from 'msw';");
  lines.push('');
  lines.push('export const handlers = [');
  for (const ep of endpoints) {
    const methodLower = ep.method.toLowerCase();
    const urlPattern = ep.path.replace(/{(\w+)}/g, ':$1');
    lines.push(`  http.${methodLower}('http://localhost:3001/api/v1${urlPattern}', () => {`);
    lines.push('    return HttpResponse.json({});');
    lines.push('  }),');
  }
  lines.push('];');
  return lines.join('\n');
}

export async function generateApiHooks(config: GeneratorConfig): Promise<void> {
  const spec = loadOpenApiSpec(config.specPath);
  const endpoints = parseEndpoints(spec);
  const outDir = config.outDir;

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, 'hooks'), { recursive: true });

  // Generate individual endpoint files
  for (const ep of endpoints) {
    const override = config.endpointOverrides.find(
      (o) => o.path === ep.path && o.method === ep.method,
    );
    if (override?.skip) continue;

    const fileName = `${ep.operationId.replace(/[^a-zA-Z0-9_$]/g, '_')}.ts`;
    const content = generateEndpointFile(ep, override);
    fs.writeFileSync(path.join(outDir, 'hooks', fileName), content, 'utf-8');
  }

  // Generate index.ts
  fs.writeFileSync(path.join(outDir, 'hooks', 'index.ts'), generateIndexFile(endpoints), 'utf-8');

  // Generate client.ts
  fs.writeFileSync(path.join(outDir, 'client.ts'), generateClientFile(), 'utf-8');

  // Generate msw handlers
  fs.writeFileSync(path.join(outDir, 'msw-handlers.ts'), generateMswHandlers(endpoints), 'utf-8');

  // Generate barrel export
  const barrelLines = [
    '// Auto-generated barrel export',
    '',
    "export { apiClient } from './client';",
    "export * from './hooks';",
    '',
  ];
  fs.writeFileSync(path.join(outDir, 'index.ts'), barrelLines.join('\n'), 'utf-8');

  console.log(`[api-hooks-generator] Generated ${endpoints.length} endpoint hooks in ${outDir}`);
}
