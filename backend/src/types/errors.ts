/**
 * types/errors.ts — Issue #719
 *
 * Structured error types with error codes. `AppError` is the single base
 * every domain error extends, so `err instanceof AppError` — the check
 * `middleware/errorHandler.ts` uses to decide whether to trust an error's
 * statusCode/code/details or fall back to a generic 500 — recognizes all of
 * them uniformly. Before this change each domain error (PaymentError,
 * AuthError, ProjectError, DisputeError, NotFoundError, ValidationError)
 * extended `Error` directly, so throwing one anywhere in the app would have
 * been silently downgraded to an opaque 500 response by the central error
 * handler, discarding its statusCode/code/details.
 */

export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;
  metadata?: Record<string, unknown>;

  constructor(
    statusCode: number,
    message: string,
    code = 'INTERNAL_SERVER_ERROR',
    details?: unknown,
    metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.metadata = metadata;
  }
}

export class PaymentError extends AppError {
  constructor(
    message: string,
    code: string = 'PAYMENT_ERROR',
    statusCode: number = 400,
    metadata?: Record<string, unknown>,
  ) {
    super(statusCode, message, code, undefined, metadata);
    this.name = 'PaymentError';
  }
}

export class AuthError extends AppError {
  constructor(
    message: string,
    code: string = 'AUTH_ERROR',
    statusCode: number = 401,
    metadata?: Record<string, unknown>,
  ) {
    super(statusCode, message, code, undefined, metadata);
    this.name = 'AuthError';
  }
}

export class ProjectError extends AppError {
  constructor(
    message: string,
    code: string = 'PROJECT_ERROR',
    statusCode: number = 400,
    metadata?: Record<string, unknown>,
  ) {
    super(statusCode, message, code, undefined, metadata);
    this.name = 'ProjectError';
  }
}

export class DisputeError extends AppError {
  constructor(
    message: string,
    code: string = 'DISPUTE_ERROR',
    statusCode: number = 400,
    metadata?: Record<string, unknown>,
  ) {
    super(statusCode, message, code, undefined, metadata);
    this.name = 'DisputeError';
  }
}

export class NotFoundError extends AppError {
  constructor(
    message: string,
    code: string = 'NOT_FOUND',
    statusCode: number = 404,
    metadata?: Record<string, unknown>,
  ) {
    super(statusCode, message, code, undefined, metadata);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    code: string = 'VALIDATION_ERROR',
    statusCode: number = 422,
    metadata?: Record<string, unknown>,
  ) {
    super(statusCode, message, code, undefined, metadata);
    this.name = 'ValidationError';
  }
}
