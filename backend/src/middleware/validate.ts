import { Request, Response, NextFunction } from 'express';
import { ZodObject, ZodSchema, ZodIssue } from 'zod';
import { logger } from '../utils/logger.js';

export interface ValidationTargets {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Keys that would pollute object prototypes if a client were allowed to set
 * them. They are rejected at every depth before schema parsing runs.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Flattens Zod issues into `{ path, message }` pairs. Zod reports unknown keys
 * once at the object's path, so each one is expanded to its own field path.
 */
function formatIssues(issues: ZodIssue[]): Array<{ path: string; message: string }> {
  return issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        path: [...issue.path, key].join('.'),
        message: 'Unrecognized field',
      }));
    }
    return [{ path: issue.path.join('.') || 'root', message: issue.message }];
  });
}

function findForbiddenKey(value: unknown, path: string[] = []): string | undefined {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findForbiddenKey(value[i], [...path, String(i)]);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) return [...path, key].join('.');
      const found = findForbiddenKey((value as Record<string, unknown>)[key], [...path, key]);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Object schemas reject keys they do not declare. Non-object schemas (unions,
 * refinements, primitives) are returned unchanged, since `.strict()` only
 * exists on `ZodObject`.
 */
export function strictSchema<T extends ZodSchema>(schema: T): T {
  if (schema instanceof ZodObject) {
    return schema.strict() as unknown as T;
  }
  return schema;
}

function rejectValidation(res: Response, target: keyof ValidationTargets, details: Array<{ path: string; message: string }>) {
  logger.warn(
    JSON.stringify({ event: 'request.validation_failed', target, issueCount: details.length, paths: details.map((d) => d.path) })
  );
  return res.status(400).json({
    error: 'VALIDATION_FAILED',
    message: 'Request validation failed',
    details,
  });
}

/**
 * Validate request body, query, and params against strict Zod schemas.
 *
 * - Unknown keys in an object schema are rejected (`.strict()`).
 * - Prototype-polluting keys (`__proto__`, `constructor`, `prototype`) are
 *   rejected at any depth in body, query, and params.
 * - Failures return a generic 400 that lists field paths and messages but
 *   never echoes submitted values. Each failure is logged with the target
 *   and field paths only.
 */
export const validateRequest = (targets: ValidationTargets) => {
  const strictTargets: ValidationTargets = {
    ...(targets.body && { body: strictSchema(targets.body) }),
    ...(targets.query && { query: strictSchema(targets.query) }),
    ...(targets.params && { params: strictSchema(targets.params) }),
  };

  return function validateRequestMiddleware(req: Request, res: Response, next: NextFunction) {
    for (const target of ['body', 'query', 'params'] as const) {
      const schema = strictTargets[target];
      if (!schema) continue;

      const forbidden = findForbiddenKey(req[target] ?? {});
      if (forbidden) {
        return rejectValidation(res, target, [{ path: forbidden, message: 'Forbidden key' }]);
      }

      const result = schema.safeParse(req[target] ?? {});
      if (!result.success) {
        return rejectValidation(res, target, formatIssues(result.error.errors));
      }
      if (target === 'body') req.body = result.data;
      else if (target === 'query') req.query = result.data as typeof req.query;
      else req.params = result.data as typeof req.params;
    }
    next();
  };
};

/**
 * Backward-compatible body-only validator.
 */
export const validate = (schema: ZodSchema) => validateRequest({ body: schema });

export default validate;
