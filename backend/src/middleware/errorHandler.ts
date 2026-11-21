/**
 * backend/src/middleware/errorHandler.ts
 *
 * Unified error handling middleware for Express backend.
 * Implements Issue #1402: single error contract across backend and edge workers.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { REQUEST_ID_HEADER } from './requestId.js';

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

// ── Error Class Hierarchy ─────────────────────────────────────────────────────

export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;
  isOperational: boolean;
  retryAfter?: number;

  constructor(
    statusCode: number,
    message: string,
    code = 'ERR_INTERNAL',
    details?: unknown,
    retryAfter?: number
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: unknown) {
    super(400, message, 'ERR_VALIDATION_FAILED', details);
    this.name = 'ValidationError';
  }
}

export class AuthError extends AppError {
  constructor(message = 'Authentication required', details?: unknown) {
    super(401, message, 'ERR_AUTH_UNAUTHENTICATED', details);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Not authorized', details?: unknown) {
    super(403, message, 'ERR_AUTH_FORBIDDEN', details);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(404, message, 'ERR_RESOURCE_NOT_FOUND', details);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource update conflict', details?: unknown) {
    super(409, message, 'ERR_CONFIG_CONFLICT', details);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded', retryAfter?: number) {
    super(429, message, 'ERR_RATE_LIMIT_EXCEEDED', undefined, retryAfter);
    this.name = 'RateLimitError';
  }
}

export class BlockchainError extends AppError {
  constructor(message = 'Blockchain transaction failed', details?: unknown) {
    super(502, message, 'ERR_BLOCKCHAIN_TRANSACTION_FAILED', details);
    this.name = 'BlockchainError';
  }
}

// ── Code Mapping & Normalization ──────────────────────────────────────────────

const LEGACY_CODE_MAP: Record<string, string> = {
  AUTHENTICATION_ERROR: 'ERR_AUTH_UNAUTHENTICATED',
  AUTHORIZATION_ERROR: 'ERR_AUTH_FORBIDDEN',
  FORBIDDEN: 'ERR_AUTH_FORBIDDEN',
  UNAUTHORIZED: 'ERR_AUTH_UNAUTHENTICATED',
  VALIDATION_ERROR: 'ERR_VALIDATION_FAILED',
  VALIDATION_FAILED: 'ERR_VALIDATION_FAILED',
  RATE_LIMIT_EXCEEDED: 'ERR_RATE_LIMIT_EXCEEDED',
  NOT_FOUND: 'ERR_RESOURCE_NOT_FOUND',
  INTERNAL_SERVER_ERROR: 'ERR_INTERNAL',
  INTERNAL_ERROR: 'ERR_INTERNAL',
  UNSUPPORTED_API_VERSION: 'ERR_RESOURCE_NOT_FOUND',
};

export function normalizeErrorCode(code?: string, status = 500): string {
  if (code && code.startsWith('ERR_')) return code;
  if (code && LEGACY_CODE_MAP[code]) return LEGACY_CODE_MAP[code];
  if (status === 400) return 'ERR_VALIDATION_FAILED';
  if (status === 401) return 'ERR_AUTH_UNAUTHENTICATED';
  if (status === 403) return 'ERR_AUTH_FORBIDDEN';
  if (status === 404) return 'ERR_RESOURCE_NOT_FOUND';
  if (status === 409) return 'ERR_CONFIG_CONFLICT';
  if (status === 429) return 'ERR_RATE_LIMIT_EXCEEDED';
  if (status === 502) return 'ERR_BLOCKCHAIN_TRANSACTION_FAILED';
  return 'ERR_INTERNAL';
}

// ── Prisma Error Translation ──────────────────────────────────────────────────

export function mapPrismaError(err: unknown): AppError | null {
  if (!err || typeof err !== 'object') return null;

  const prismaErr = err as { code?: string; name?: string; message?: string };
  // Check for PrismaClientKnownRequestError
  if (prismaErr.code) {
    switch (prismaErr.code) {
      case 'P2002':
        return new ConflictError('Unique constraint violation: resource already exists');
      case 'P2025':
        return new NotFoundError('Record not found');
      case 'P2003':
        return new ValidationError('Foreign key constraint violation: referenced record does not exist');
      default:
        return new AppError(400, 'Database query failed', 'ERR_VALIDATION_FAILED');
    }
  }

  if (prismaErr.name === 'PrismaClientValidationError') {
    return new ValidationError('Invalid data provided to database operation');
  }

  return null;
}

// ── Middleware Helpers ────────────────────────────────────────────────────────

export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  // Translate Prisma errors into known AppErrors
  const prismaMapped = mapPrismaError(err);
  const resolvedErr = prismaMapped ?? err;

  const isAppError = resolvedErr instanceof AppError;
  const statusCode = isAppError ? resolvedErr.statusCode : 500;
  const rawCode = isAppError ? resolvedErr.code : 'ERR_INTERNAL';
  const code = normalizeErrorCode(rawCode, statusCode);

  const isProduction = process.env.NODE_ENV === 'production';
  const message = isAppError
    ? resolvedErr.message
    : isProduction
      ? 'Internal server error'
      : resolvedErr instanceof Error
        ? resolvedErr.message
        : 'Unexpected error';

  const requestId =
    (req.headers ? (req.headers[REQUEST_ID_HEADER] as string || req.headers['x-request-id'] as string) : undefined) ||
    (req as any).id ||
    (req as any).correlationId;

  // Single structured log statement at appropriate severity
  const logPrefix = `[${code}] [${statusCode}]${requestId ? ` [req:${requestId}]` : ''}: ${message}`;
  if (statusCode >= 500) {
    console.error(logPrefix, resolvedErr);
  } else {
    console.warn(logPrefix);
  }

  const errorPayload: Record<string, unknown> = {
    code,
    message,
    status: statusCode,
  };

  if (isAppError && resolvedErr.details !== undefined) {
    errorPayload.details = resolvedErr.details;
  }

  if (isAppError && resolvedErr.retryAfter !== undefined) {
    errorPayload.retryAfter = resolvedErr.retryAfter;
  }

  if (requestId) {
    errorPayload.requestId = requestId;
  }

  // Developer stack trace only in non-production for unknown internal errors
  if (!isProduction && !isAppError && resolvedErr instanceof Error && resolvedErr.stack) {
    errorPayload.stack = resolvedErr.stack;
  }

  res.status(statusCode).json({ error: errorPayload });
}
