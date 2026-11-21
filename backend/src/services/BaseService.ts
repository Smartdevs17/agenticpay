/**
 * BaseService.ts — Issue #366
 *
 * Base service class that encapsulates business logic
 * Services coordinate between repositories and implement business rules
 */

import { err, ok, Result, ServiceError } from '../lib/result.js';

export abstract class BaseService {

  protected ok<T>(value: T): Result<T> {
    return ok(value);
  }

  protected fail(message: string, statusCode: number, code: string, details?: Record<string, unknown>): Result<never> {
    return err({ code, message, statusCode, details });
  }

  protected validationFailure(message: string, details?: Record<string, unknown>): Result<never> {
    return this.fail(message, 400, "VALIDATION_ERROR", details);
  }

  protected notFoundFailure(resource: string, id: string): Result<never> {
    return this.fail(`${resource} not found: ${id}`, 404, "NOT_FOUND");
  }

  protected forbiddenFailure(message: string): Result<never> {
    return this.fail(message, 403, "FORBIDDEN");
  }

  protected conflictFailure(message: string): Result<never> {
    return this.fail(message, 409, "CONFLICT");
  }

  protected unexpectedFailure(error: unknown): Result<never> {
    const serviceError: ServiceError = {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unexpected service error",
      statusCode: 500,
      cause: error,
    };
    return err(serviceError);
  }
  /**
   * Validate business rules
   */
  protected validate(
    condition: boolean,
    message: string,
    code = "VALIDATION_ERROR",
  ): void {
    if (!condition) {
      const error = new Error(message) as Error & {
        statusCode: number;
        code: string;
      };
      error.statusCode = 400;
      error.code = code;
      throw error;
    }
  }

  /**
   * Handle not found errors
   */
  protected notFound(resource: string, id: string): never {
    const error = new Error(`${resource} not found: ${id}`) as Error & {
      statusCode: number;
      code: string;
    };
    error.statusCode = 404;
    error.code = "NOT_FOUND";
    throw error;
  }

  /**
   * Handle conflict errors
   */
  protected conflict(message: string): never {
    const error = new Error(message) as Error & {
      statusCode: number;
      code: string;
    };
    error.statusCode = 409;
    error.code = "CONFLICT";
    throw error;
  }

  /**
   * Handle forbidden errors
   */
  protected forbidden(message: string): never {
    const error = new Error(message) as Error & {
      statusCode: number;
      code: string;
    };
    error.statusCode = 403;
    error.code = "FORBIDDEN";
    throw error;
  }
}
