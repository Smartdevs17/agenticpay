import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_CODE_REGISTRY, resolveErrorCode } from '@agenticpay/error-codes';

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, message: string, code = 'INTERNAL_SERVER_ERROR', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`, 'NOT_FOUND'));
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = resolveErrorCode(isAppError ? err.code : undefined, statusCode);
  const registered = ERROR_CODE_REGISTRY[code];
  const isProduction = process.env.NODE_ENV === 'production';
  const message = isAppError
    ? err.message
    : isProduction
      ? 'Internal server error'
      : err instanceof Error
        ? err.message
        : 'Unexpected error';

  const logMethod = registered.httpStatus >= 500 ? console.error : console.warn;
  logMethod(`[${code}] ${message}`, err);

  if (registered.deprecated && registered.sunsetAt) {
    res.setHeader('Sunset', registered.sunsetAt);
    res.setHeader('Deprecation', 'true');
  }

  res.status(registered.httpStatus || statusCode).json({
    error: {
      code,
      message,
      ...(isAppError && err.details !== undefined ? { details: err.details } : {}),
      ...(req.requestId ? { requestId: req.requestId } : {}),
      ...(!isProduction && !isAppError && err instanceof Error && err.stack
        ? { stack: err.stack }
        : {}),
    },
  });
}
