import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError, ZodSchema, z } from 'zod';
import { AppError } from '../types/errors.js';
import { InputSanitizer, SanitizeOptions } from './sanitize.js';

export interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
  headers?: ZodSchema;
}

export interface ValidationOptions {
  sanitize?: boolean;
  sanitizer?: SanitizeOptions;
  stripUnknown?: boolean;
}

export const commonSchemas = {
  uuid: z.string().uuid(),
  id: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/),
  email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
  pagination: z.object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
  stellarAddress: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar address format'),
  amount: z.coerce.number().positive().finite().max(1_000_000_000),
};

function sanitizeValue(value: unknown, options?: SanitizeOptions): unknown {
  return InputSanitizer.getInstance().sanitize(value, {
    sqlEscape: false,
    htmlSanitization: false,
    escapeHtml: false,
    ...options,
  });
}

function parseSchema(schema: ZodSchema, value: unknown, stripUnknown?: boolean): unknown {
  if (stripUnknown && schema instanceof z.ZodObject) {
    return (schema as AnyZodObject).strip().parse(value ?? {});
  }

  return schema.parse(value ?? {});
}

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
    code: issue.code,
  }));
}

function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError || (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'ZodError' &&
    Array.isArray((error as { errors?: unknown }).errors)
  );
}

export function validateAndSanitize(
  schemas: ValidationSchemas,
  options: ValidationOptions = {}
) {
  return function validationMiddleware(req: Request, _res: Response, next: NextFunction) {
    try {
      const shouldSanitize = options.sanitize ?? true;

      if (schemas.body) {
        const value = shouldSanitize ? sanitizeValue(req.body ?? {}, options.sanitizer) : req.body;
        req.body = parseSchema(schemas.body, value, options.stripUnknown);
      }

      if (schemas.query) {
        const value = shouldSanitize ? sanitizeValue(req.query ?? {}, options.sanitizer) : req.query;
        req.query = parseSchema(schemas.query, value, options.stripUnknown) as typeof req.query;
      }

      if (schemas.params) {
        const value = shouldSanitize ? sanitizeValue(req.params ?? {}, options.sanitizer) : req.params;
        req.params = parseSchema(schemas.params, value, options.stripUnknown) as typeof req.params;
      }

      if (schemas.headers) {
        const headers = Object.fromEntries(
          Object.entries(req.headers).map(([key, value]) => [key.toLowerCase(), value])
        );
        parseSchema(schemas.headers, headers, options.stripUnknown);
      }

      next();
    } catch (error) {
      if (isZodError(error)) {
        return next(
          new AppError(
            400,
            'Request validation failed',
            'ERR_VALIDATION_FAILED',
            formatZodError(error)
          )
        );
      }

      next(error);
    }
  };
}

export const validateRequest = validateAndSanitize;
export const validateBody = (schema: ZodSchema, options?: ValidationOptions) =>
  validateAndSanitize({ body: schema }, options);

export default validateAndSanitize;
