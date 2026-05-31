/**
 * BaseService.ts — Issue #366
 *
 * Base service class that encapsulates business logic
 * Services coordinate between repositories and implement business rules
 */

export abstract class BaseService {
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
