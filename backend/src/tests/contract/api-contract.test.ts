/**
 * API contract tests (#870).
 *
 * Guards the HTTP contract shared by backend, frontend hooks, and generated
 * SDKs:
 *  - `docs/api/openapi/openapi.json` is a valid OpenAPI 3.x document with
 *    unique operationIds, documented responses, and stable critical paths.
 *  - `docs/api/openapi/swagger.json` (tsoa output) stays parseable and
 *    consistent.
 *  - Every registered error code follows the `ERR_*` envelope convention.
 *
 * File-based on purpose: no server, database, or network required, so this
 * suite runs in plain `npm test` and in CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ERROR_CODE_REGISTRY } from '../../../../packages/error-codes/src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPENAPI_DIR = path.resolve(__dirname, '../../../docs/api/openapi');

interface OpenApiOperation {
  operationId?: string;
  tags?: string[];
  responses?: Record<string, unknown>;
}

interface OpenApiDocument {
  openapi: string;
  info?: { title?: string; version?: string };
  servers?: Array<{ url?: string }>;
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

function loadJson(fileName: string): OpenApiDocument {
  const filePath = path.join(OPENAPI_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing contract document: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as OpenApiDocument;
}

function allOperations(document: OpenApiDocument): Array<{ path: string; method: string; operation: OpenApiOperation }> {
  const entries: Array<{ path: string; method: string; operation: OpenApiOperation }> = [];
  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) continue;
      entries.push({ path: routePath, method, operation });
    }
  }
  return entries;
}

describe('OpenAPI contract (openapi.json)', () => {
  const document = loadJson('openapi.json');

  it('is a valid OpenAPI 3.x document', () => {
    expect(document.openapi).toMatch(/^3\./);
    expect(document.info?.title).toBeTruthy();
    expect(document.info?.version).toBeTruthy();
    expect(Object.keys(document.paths ?? {}).length).toBeGreaterThan(0);
  });

  it('advertises reachable servers', () => {
    expect(Array.isArray(document.servers)).toBe(true);
    expect(document.servers.length).toBeGreaterThan(0);
    for (const server of document.servers) {
      expect(server.url).toMatch(/^https?:\/\//);
    }
  });

  it('keeps critical paths stable', () => {
    const routes = allOperations(document);
    const has = (routePath: string, method: string) =>
      routes.some((entry) => entry.path === routePath && entry.method === method);

    // Critical payment paths — renaming or dropping any of these is breaking.
    expect(has('/health', 'get')).toBe(true);
    expect(has('/escrow', 'post')).toBe(true);
    expect(has('/disputes', 'post')).toBe(true);
    expect(has('/sandbox/payments/process', 'post')).toBe(true);
    expect(has('/verification/verify', 'post')).toBe(true);
    expect(has('/invoice/generate', 'post')).toBe(true);
  });

  it('gives every operation a unique operationId', () => {
    const routes = allOperations(document);
    expect(routes.length).toBeGreaterThan(0);
    const ids = routes.map((entry) => entry.operation?.operationId);
    for (const entry of routes) {
      expect(
        typeof entry.operation?.operationId === 'string' && entry.operation.operationId.length > 0,
        `${entry.method.toUpperCase()} ${entry.path} must define an operationId`
      ).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('documents at least one success response per operation', () => {
    for (const entry of allOperations(document)) {
      const statuses = Object.keys(entry.operation?.responses ?? {});
      expect(
        statuses.length > 0,
        `${entry.method.toUpperCase()} ${entry.path} must document responses`
      ).toBe(true);
      expect(
        statuses.some((status) => status.startsWith('2')),
        `${entry.method.toUpperCase()} ${entry.path} must document a 2xx response`
      ).toBe(true);
    }
  });

  it('uses OpenAPI-style path templates (no Express :params)', () => {
    for (const routePath of Object.keys(document.paths ?? {})) {
      expect(routePath.startsWith('/')).toBe(true);
      expect(routePath, `${routePath} must use {param} placeholders`).not.toMatch(/\/:[A-Za-z]/);
    }
  });
});

describe('tsoa contract (swagger.json)', () => {
  const document = loadJson('swagger.json');

  it('stays parseable OpenAPI 3.x with documented operations', () => {
    expect(document.openapi).toMatch(/^3\./);
    const routes = allOperations(document);
    expect(routes.length).toBeGreaterThan(0);
    for (const entry of routes) {
      expect(Object.keys(entry.operation?.responses ?? {}).length).toBeGreaterThan(0);
    }
  });

  it('covers the health probe used by load tests and monitors', () => {
    const routes = allOperations(document);
    expect(routes.some((entry) => entry.path === '/health' && entry.method === 'get')).toBe(true);
  });
});

describe('error code registry contract', () => {
  const entries = Object.entries(ERROR_CODE_REGISTRY);

  it('registers at least one error code', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('keys every code as ERR_* and mirrors it on the definition', () => {
    for (const [key, definition] of entries) {
      expect(key).toMatch(/^ERR_[A-Z0-9_]+$/);
      expect(definition.code).toBe(key);
    }
  });

  it('maps every code to a 4xx/5xx status with guidance', () => {
    const categories = new Set(['auth', 'validation', 'payment', 'blockchain', 'rate_limit', 'configuration', 'internal']);
    for (const [, definition] of entries) {
      expect(Number.isInteger(definition.httpStatus)).toBe(true);
      expect(definition.httpStatus).toBeGreaterThanOrEqual(400);
      expect(definition.httpStatus).toBeLessThan(600);
      expect(categories.has(definition.category)).toBe(true);
      expect(definition.message.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.resolution.length).toBeGreaterThan(0);
      if (definition.deprecated === true) {
        expect(definition.replacedBy ?? definition.sunsetAt).toBeTruthy();
      }
    }
  });
});

describe('error response envelope', () => {
  const EnvelopeSchema = z.object({
    error: z.object({
      code: z.string().regex(/^ERR_[A-Z0-9_]+$/),
      message: z.string().min(1),
      details: z.unknown().optional(),
      requestId: z.string().optional(),
    }),
  });

  it('accepts a well-formed envelope', () => {
    expect(() =>
      EnvelopeSchema.parse({ error: { code: 'ERR_AUTH_UNAUTHENTICATED', message: 'Authentication required' } })
    ).not.toThrow();
  });

  it('rejects envelopes that break the ERR_* convention', () => {
    expect(() => EnvelopeSchema.parse({ error: { code: 'unauthenticated', message: 'nope' } })).toThrow();
    expect(() => EnvelopeSchema.parse({ error: { message: 'missing code' } })).toThrow();
    expect(() => EnvelopeSchema.parse({})).toThrow();
  });
});
