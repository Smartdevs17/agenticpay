import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_CODE_REGISTRY, resolveErrorCode } from '@agenticpay/error-codes';
import { AppError, PaymentError, AuthError, ProjectError, DisputeError, ValidationError, NotFoundError } from '../types/errors';

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export { AppError, PaymentError, AuthError, ProjectError, DisputeError, ValidationError, NotFoundError };

export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
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
  const logContext = {
    code,
    message,
    statusCode: registered.httpStatus || statusCode,
    ...(isAppError && err.metadata ? { metadata: err.metadata } : {}),
    ...(req.requestId ? { requestId: req.requestId } : {}),
    ...(req.user?.id ? { userId: req.user.id } : {}),
    ...(!isProduction && !isAppError && err instanceof Error && err.stack ? { stack: err.stack } : {}),
  };
  logMethod(`[${code}] ${message}`, logContext);

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
