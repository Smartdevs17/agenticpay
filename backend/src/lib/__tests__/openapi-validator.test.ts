import { describe, it, expect } from 'vitest';
import { validateOpenApi } from '../openapi-validator.js';

/** Minimal document that passes every structural check. */
function validDoc(overrides: Record<string, unknown> = {}) {
  return {
    openapi: '3.1.0',
    info: { title: 'AgenticPay API', version: '1.0.0' },
    paths: {
      '/health': {
        get: {
          operationId: 'getHealth',
          tags: ['Health'],
          responses: { '200': { description: 'Ok' } },
        },
      },
    },
    components: {
      schemas: {
        Health: { type: 'object', properties: { status: { type: 'string' } } },
      },
    },
    ...overrides,
  };
}

function messages(errors: Array<{ message: string }>): string {
  return errors.map((e) => e.message).join('\n');
}

describe('validateOpenApi', () => {
  it('accepts a well-formed 3.1 document', () => {
    const result = validateOpenApi(validDoc());

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.stats).toEqual({ version: '3.1.0', paths: 1, operations: 1, schemas: 1 });
  });

  it('rejects a document that is not an object', () => {
    expect(validateOpenApi(null).valid).toBe(false);
    expect(validateOpenApi([]).valid).toBe(false);
    expect(validateOpenApi('a string').valid).toBe(false);
  });

  it('rejects a 2.0 document, which is the regression this guards', () => {
    const result = validateOpenApi(validDoc({ openapi: '2.0' }));

    expect(result.valid).toBe(false);
    expect(messages(result.errors)).toMatch(/Expected an OpenAPI 3\.1\.x document/);
  });

  it('rejects a 3.0 document', () => {
    expect(validateOpenApi(validDoc({ openapi: '3.0.0' })).valid).toBe(false);
  });

  it('requires the version field', () => {
    const doc = validDoc();
    delete (doc as Record<string, unknown>).openapi;

    expect(messages(validateOpenApi(doc).errors)).toMatch(/Missing "openapi"/);
  });

  it('requires a title and version in info', () => {
    const result = validateOpenApi(validDoc({ info: {} }));

    expect(messages(result.errors)).toMatch(/info\.title is required/);
    expect(messages(result.errors)).toMatch(/info\.version is required/);
  });

  it('rejects a document with no paths', () => {
    const result = validateOpenApi(validDoc({ paths: {} }));

    expect(messages(result.errors)).toMatch(/declares no paths/);
  });

  it('requires an operationId so SDK methods can be named', () => {
    const result = validateOpenApi(
      validDoc({
        paths: { '/health': { get: { tags: ['Health'], responses: { '200': { description: 'Ok' } } } } },
      })
    );

    expect(result.valid).toBe(false);
    expect(messages(result.errors)).toMatch(/operationId is required/);
  });

  it('rejects duplicate operationIds, which collide in generated clients', () => {
    const result = validateOpenApi(
      validDoc({
        paths: {
          '/a': { get: { operationId: 'same', responses: { '200': { description: 'Ok' } } } },
          '/b': { get: { operationId: 'SAME', responses: { '200': { description: 'Ok' } } } },
        },
      })
    );

    expect(messages(result.errors)).toMatch(/Duplicate operationId "SAME"/);
  });

  it('rejects an operation with no responses', () => {
    const result = validateOpenApi(
      validDoc({ paths: { '/a': { get: { operationId: 'a', responses: {} } } } })
    );

    expect(messages(result.errors)).toMatch(/Operation declares no responses/);
  });

  it('counts every HTTP method in a path item', () => {
    const result = validateOpenApi(
      validDoc({
        paths: {
          '/keys': {
            get: { operationId: 'listKeys', responses: { '200': { description: 'Ok' } } },
            post: { operationId: 'createKey', responses: { '201': { description: 'Created' } } },
            delete: { operationId: 'deleteKey', responses: { '204': { description: 'No content' } } },
          },
        },
      })
    );

    expect(result.stats.operations).toBe(3);
  });

  it('catches a dangling $ref, the failure found in the tsoa output', () => {
    const result = validateOpenApi(
      validDoc({
        components: { schemas: {} },
        paths: {
          '/health': {
            get: {
              operationId: 'getHealth',
              responses: {
                '200': {
                  description: 'Ok',
                  content: {
                    'application/json': { schema: { $ref: '#/components/schemas/HealthCheckResponse' } },
                  },
                },
              },
            },
          },
        },
      })
    );

    expect(result.valid).toBe(false);
    expect(messages(result.errors)).toMatch(/Unresolved \$ref "#\/components\/schemas\/HealthCheckResponse"/);
  });

  it('accepts a $ref that resolves', () => {
    const result = validateOpenApi(
      validDoc({
        paths: {
          '/health': {
            get: {
              operationId: 'getHealth',
              responses: {
                '200': {
                  description: 'Ok',
                  content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } },
                },
              },
            },
          },
        },
      })
    );

    expect(result.valid).toBe(true);
  });

  it('resolves a $ref containing escaped pointer segments', () => {
    const result = validateOpenApi(
      validDoc({
        paths: {
          '/a': {
            get: {
              operationId: 'a',
              responses: {
                '200': {
                  description: 'Ok',
                  content: { 'application/json': { schema: { $ref: '#/components/schemas/we~1ird' } } },
                },
              },
            },
          },
        },
        components: { schemas: { 'we/ird': { type: 'string' } } },
      })
    );

    expect(result.valid).toBe(true);
  });

  it('ignores external refs it cannot resolve offline', () => {
    const result = validateOpenApi(
      validDoc({
        paths: {
          '/a': {
            get: {
              operationId: 'a',
              responses: {
                '200': {
                  description: 'Ok',
                  content: { 'application/json': { schema: { $ref: 'other.json#/X' } } },
                },
              },
            },
          },
        },
      })
    );

    expect(result.valid).toBe(true);
  });

  it('finds a $ref nested inside an array or a nested object', () => {
    const result = validateOpenApi(
      validDoc({
        paths: {
          '/a': {
            post: {
              operationId: 'a',
              responses: { '200': { description: 'Ok' } },
              requestBody: {
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { $ref: '#/components/schemas/Missing' } },
                  },
                },
              },
            },
          },
        },
      })
    );

    expect(messages(result.errors)).toMatch(/Unresolved \$ref "#\/components\/schemas\/Missing"/);
  });

  it('warns without failing when an operation has no tags', () => {
    const result = validateOpenApi(
      validDoc({ paths: { '/a': { get: { operationId: 'a', responses: { '200': { description: 'Ok' } } } } } })
    );

    expect(result.valid).toBe(true);
    expect(messages(result.warnings)).toMatch(/no tags/);
  });

  it('warns when no component schemas are declared', () => {
    const result = validateOpenApi(validDoc({ components: {} }));

    expect(result.valid).toBe(true);
    expect(messages(result.warnings)).toMatch(/No component schemas declared/);
  });
});
