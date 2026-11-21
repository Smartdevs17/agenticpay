import { z } from 'zod';
export { jsonSchemaToZod } from './schema-compiler.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiOperationSchema {
  method: HttpMethod;
  path: string;
  operationId: string;
  tags: string[];
  summary: string;
  deprecated?: boolean;
  sunset?: string;
  request?: {
    body?: z.ZodTypeAny;
    query?: z.ZodTypeAny;
    params?: z.ZodTypeAny;
  };
  responses: Record<number, z.ZodTypeAny>;
}

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().regex(/^ERR_[A-Z0-9_]+$/),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});

export const ConfigValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.unknown()),
  z.record(z.unknown()),
  z.null(),
]);

export const ConfigDefinitionSchema = z.object({
  key: z.string(),
  description: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  defaultValue: ConfigValueSchema,
  value: ConfigValueSchema,
  source: z.enum(['default', 'environment', 'database', 'runtime']),
  version: z.number().int().optional(),
  updatedAt: z.string().optional(),
});

export const UpdateConfigRequestSchema = z.object({
  value: ConfigValueSchema,
  reason: z.string().min(3).max(500).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export const ImportConfigRequestSchema = z.object({
  values: z.record(ConfigValueSchema),
  reason: z.string().min(3).max(500).optional(),
});

export const ConfigListResponseSchema = z.object({
  data: z.array(ConfigDefinitionSchema),
});

export const ConfigAuditLogResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      oldValue: z.unknown().nullable(),
      newValue: z.unknown().nullable(),
      actor: z.string().nullable(),
      reason: z.string().nullable(),
      source: z.string(),
      createdAt: z.string(),
      requestId: z.string().nullable(),
    })
  ),
});

export const ErrorRegistryResponseSchema = z.object({
  data: z.array(
    z.object({
      code: z.string(),
      category: z.string(),
      httpStatus: z.number(),
      message: z.string(),
      description: z.string(),
      resolution: z.string(),
      deprecated: z.boolean().optional(),
      sunsetAt: z.string().optional(),
      replacedBy: z.string().optional(),
    })
  ),
});

export const API_OPERATIONS: ApiOperationSchema[] = [
  {
    method: 'GET',
    path: '/api/v1/admin/configuration',
    operationId: 'listConfiguration',
    tags: ['Configuration'],
    summary: 'List resolved application configuration',
    responses: { 200: ConfigListResponseSchema, 400: ErrorResponseSchema, 500: ErrorResponseSchema },
  },
  {
    method: 'PUT',
    path: '/api/v1/admin/configuration/{key}',
    operationId: 'updateConfiguration',
    tags: ['Configuration'],
    summary: 'Update a configuration value',
    request: {
      params: z.object({ key: z.string().min(1) }),
      body: UpdateConfigRequestSchema,
    },
    responses: { 200: ConfigDefinitionSchema, 400: ErrorResponseSchema, 409: ErrorResponseSchema, 500: ErrorResponseSchema },
  },
  {
    method: 'POST',
    path: '/api/v1/admin/configuration/import',
    operationId: 'importConfiguration',
    tags: ['Configuration'],
    summary: 'Import configuration values',
    request: { body: ImportConfigRequestSchema },
    responses: { 200: z.object({ updated: z.number() }), 400: ErrorResponseSchema, 500: ErrorResponseSchema },
  },
  {
    method: 'GET',
    path: '/api/v1/admin/configuration/audit',
    operationId: 'listConfigurationAudit',
    tags: ['Configuration'],
    summary: 'List configuration audit entries',
    responses: { 200: ConfigAuditLogResponseSchema, 500: ErrorResponseSchema },
  },
  {
    method: 'GET',
    path: '/api/errors',
    operationId: 'listErrorCodes',
    tags: ['Errors'],
    summary: 'List registered API error codes',
    responses: { 200: ErrorRegistryResponseSchema },
  },
];

export function pathToOpenApi(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

export function pathToRegex(path: string): { regex: RegExp; params: string[] } {
  const params: string[] = [];
  const pattern = path
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{([A-Za-z0-9_]+)\\\}/g, (_match, param) => {
      params.push(param);
      return '([^/]+)';
    });
  return { regex: new RegExp(`^${pattern}$`), params };
}

export function buildOpenApiDocument() {
  const paths: Record<string, any> = {};
  for (const operation of API_OPERATIONS) {
    const path = pathToOpenApi(operation.path);
    paths[path] ??= {};
    const responses: Record<string, any> = {};
    for (const [status, schema] of Object.entries(operation.responses)) {
      responses[status] = {
        description: status.startsWith('2') ? 'Success' : 'Error',
        content: { 'application/json': { schema: { type: 'object', 'x-zod-schema': schema.description } } },
      };
    }
    paths[path][operation.method.toLowerCase()] = {
      operationId: operation.operationId,
      tags: operation.tags,
      summary: operation.summary,
      deprecated: operation.deprecated ?? false,
      responses,
      ...(operation.sunset ? { 'x-sunset': operation.sunset } : {}),
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'AgenticPay API',
      version: '0.1.0',
      description: 'OpenAPI-first API contract for AgenticPay.',
    },
    servers: [{ url: 'http://localhost:3001' }],
    paths,
    components: {
      schemas: {
        ErrorResponse: { type: 'object' },
      },
    },
  };
}
