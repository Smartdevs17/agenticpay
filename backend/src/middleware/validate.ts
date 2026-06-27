import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError, ZodIssue } from 'zod';
import { AppError } from './errorHandler.js';

export interface ValidationTargets {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

function formatIssues(issues: ZodIssue[]) {
  return issues.map((err) => ({
    path: err.path.join('.') || 'root',
    message: err.message,
  }));
}

/**
 * Validate request body, query, and params against Zod schemas.
 * Returns generic 400 responses without leaking internal details.
 */
export const validateRequest = (targets: ValidationTargets) => {
  return function validateRequestMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
      if (targets.body) {
        req.body = targets.body.parse(req.body ?? {});
      }
      if (targets.query) {
        req.query = targets.query.parse(req.query ?? {}) as typeof req.query;
      }
      if (targets.params) {
        req.params = targets.params.parse(req.params ?? {}) as typeof req.params;
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return next(new AppError(400, 'Request validation failed', 'ERR_VALIDATION_FAILED', formatIssues(error.errors)));
      }
      next(error);
    }
  };
};

/**
 * Backward-compatible body-only validator.
 */
export const validate = (schema: ZodSchema) => validateRequest({ body: schema });

export default validate;
