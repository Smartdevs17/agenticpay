/**
 * responseFormatter.ts — Issue #367
 *
 * Standardizes API response format across all endpoints with:
 * - Uniform response envelope: { data, meta, error }
 * - Standardized error codes with HTTP status mapping
 * - Consistent pagination (cursor-based for lists)
 * - Backward compatibility support
 */

import { Request, Response, NextFunction } from "express";

// ── Response Envelope Types ────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  data?: T;
  meta?: ResponseMeta;
  error?: ApiError;
}

export interface ResponseMeta {
  timestamp: string;
  requestId?: string;
  version?: string;
  pagination?: PaginationMeta;
  [key: string]: unknown;
}

export interface PaginationMeta {
  cursor?: string;
  nextCursor?: string | null;
  prevCursor?: string | null;
  hasMore: boolean;
  limit: number;
  total?: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  stack?: string;
}

// ── Error Code Taxonomy ────────────────────────────────────────────────────────

export enum ErrorCode {
  // Client Errors (4xx)
  BAD_REQUEST = "BAD_REQUEST",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED",
  CONFLICT = "CONFLICT",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE",
  UNSUPPORTED_MEDIA_TYPE = "UNSUPPORTED_MEDIA_TYPE",

  // Server Errors (5xx)
  INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR",
  NOT_IMPLEMENTED = "NOT_IMPLEMENTED",
  BAD_GATEWAY = "BAD_GATEWAY",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  GATEWAY_TIMEOUT = "GATEWAY_TIMEOUT",

  // Business Logic Errors
  INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
  TRANSACTION_FAILED = "TRANSACTION_FAILED",
  INVALID_STATE = "INVALID_STATE",
  RESOURCE_LOCKED = "RESOURCE_LOCKED",
  DUPLICATE_ENTRY = "DUPLICATE_ENTRY",

  // External Service Errors
  EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
  BLOCKCHAIN_ERROR = "BLOCKCHAIN_ERROR",
  PAYMENT_PROVIDER_ERROR = "PAYMENT_PROVIDER_ERROR",
}

const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.METHOD_NOT_ALLOWED]: 405,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.VALIDATION_ERROR]: 422,
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorCode.PAYLOAD_TOO_LARGE]: 413,
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: 415,

  [ErrorCode.INTERNAL_SERVER_ERROR]: 500,
  [ErrorCode.NOT_IMPLEMENTED]: 501,
  [ErrorCode.BAD_GATEWAY]: 502,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.GATEWAY_TIMEOUT]: 504,

  [ErrorCode.INSUFFICIENT_FUNDS]: 400,
  [ErrorCode.TRANSACTION_FAILED]: 400,
  [ErrorCode.INVALID_STATE]: 400,
  [ErrorCode.RESOURCE_LOCKED]: 423,
  [ErrorCode.DUPLICATE_ENTRY]: 409,

  [ErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
  [ErrorCode.BLOCKCHAIN_ERROR]: 502,
  [ErrorCode.PAYMENT_PROVIDER_ERROR]: 502,
};

// ── Response Builder ───────────────────────────────────────────────────────────

export class ResponseBuilder {
  private response: ApiResponse;
  private statusCode: number;

  constructor() {
    this.response = {};
    this.statusCode = 200;
  }

  data<T>(data: T): this {
    this.response.data = data;
    return this;
  }

  meta(meta: Partial<ResponseMeta>): this {
    this.response.meta = {
      timestamp: new Date().toISOString(),
      ...this.response.meta,
      ...meta,
    };
    return this;
  }

  pagination(pagination: PaginationMeta): this {
    this.response.meta = {
      ...this.response.meta,
      timestamp: this.response.meta?.timestamp || new Date().toISOString(),
      pagination,
    };
    return this;
  }

  error(
    code: ErrorCode | string,
    message: string,
    details?: Record<string, unknown>,
  ): this {
    this.response.error = {
      code,
      message,
      details,
    };

    // Set status code based on error code
    if (Object.values(ErrorCode).includes(code as ErrorCode)) {
      this.statusCode = ERROR_STATUS_MAP[code as ErrorCode];
    } else {
      this.statusCode = 500;
    }

    return this;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  build(): { response: ApiResponse; statusCode: number } {
    // Ensure meta always has timestamp
    if (!this.response.meta) {
      this.response.meta = {
        timestamp: new Date().toISOString(),
      };
    } else if (!this.response.meta.timestamp) {
      this.response.meta.timestamp = new Date().toISOString();
    }

    return {
      response: this.response,
      statusCode: this.statusCode,
    };
  }
}

// ── Express Middleware ─────────────────────────────────────────────────────────

declare module "express-serve-static-core" {
  interface Response {
    apiSuccess<T>(data: T, meta?: Partial<ResponseMeta>): Response;
    apiError(
      code: ErrorCode | string,
      message: string,
      details?: Record<string, unknown>,
    ): Response;
    apiPaginated<T>(
      data: T[],
      pagination: PaginationMeta,
      meta?: Partial<ResponseMeta>,
    ): Response;
  }
}

/**
 * Attach response helper methods to Express Response object
 */
export function attachResponseHelpers(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Success response
  res.apiSuccess = function <T>(
    data: T,
    meta?: Partial<ResponseMeta>,
  ): Response {
    const builder = new ResponseBuilder().data(data).meta({
      requestId: req.id,
      version: (req.headers["api-version"] as string) || "v1",
      ...meta,
    });

    const { response, statusCode } = builder.build();
    return this.status(statusCode).json(response);
  };

  // Error response
  res.apiError = function (
    code: ErrorCode | string,
    message: string,
    details?: Record<string, unknown>,
  ): Response {
    const builder = new ResponseBuilder().error(code, message, details).meta({
      requestId: req.id,
      version: (req.headers["api-version"] as string) || "v1",
    });

    const { response, statusCode } = builder.build();
    return this.status(statusCode).json(response);
  };

  // Paginated response
  res.apiPaginated = function <T>(
    data: T[],
    pagination: PaginationMeta,
    meta?: Partial<ResponseMeta>,
  ): Response {
    const builder = new ResponseBuilder()
      .data(data)
      .pagination(pagination)
      .meta({
        requestId: req.id,
        version: (req.headers["api-version"] as string) || "v1",
        ...meta,
      });

    const { response, statusCode } = builder.build();
    return this.status(statusCode).json(response);
  };

  next();
}

/**
 * Global error handler that formats errors consistently
 */
export function formatErrorResponse(
  err: Error & {
    statusCode?: number;
    code?: string;
    details?: Record<string, unknown>;
  },
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const statusCode = err.statusCode || 500;
  const errorCode = err.code || ErrorCode.INTERNAL_SERVER_ERROR;
  const message = err.message || "An unexpected error occurred";

  const builder = new ResponseBuilder()
    .error(errorCode, message, err.details)
    .meta({
      requestId: req.id,
      version: (req.headers["api-version"] as string) || "v1",
    })
    .status(statusCode);

  // Include stack trace in development
  if (process.env.NODE_ENV === "development") {
    builder.error(errorCode, message, {
      ...err.details,
      stack: err.stack,
    });
  }

  const { response, statusCode: finalStatus } = builder.build();
  res.status(finalStatus).json(response);
}

// ── Pagination Helpers ─────────────────────────────────────────────────────────

export interface CursorPaginationParams {
  cursor?: string;
  limit?: number;
  direction?: "forward" | "backward";
}

export function parsePaginationParams(req: Request): CursorPaginationParams {
  const cursor = req.query.cursor as string | undefined;
  const limit = Math.min(
    parseInt(req.query.limit as string) || 20,
    100, // Max limit
  );
  const direction =
    (req.query.direction as string) === "backward" ? "backward" : "forward";

  return { cursor, limit, direction };
}

/**
 * Encode cursor from object
 */
export function encodeCursor(data: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

/**
 * Decode cursor to object
 */
export function decodeCursor(cursor: string): Record<string, unknown> | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * Build pagination metadata from results
 */
export function buildPaginationMeta<
  T extends { id: string; createdAt?: string },
>(items: T[], limit: number, hasMore: boolean, total?: number): PaginationMeta {
  const nextCursor =
    hasMore && items.length > 0
      ? encodeCursor({
          id: items[items.length - 1].id,
          createdAt:
            items[items.length - 1].createdAt || new Date().toISOString(),
        })
      : null;

  const prevCursor =
    items.length > 0
      ? encodeCursor({
          id: items[0].id,
          createdAt: items[0].createdAt || new Date().toISOString(),
        })
      : null;

  return {
    nextCursor,
    prevCursor,
    hasMore,
    limit,
    total,
  };
}

// ── Backward Compatibility ────────────────────────────────────────────────────

/**
 * Middleware to support legacy response format
 * Checks for X-Legacy-Format header
 */
export function legacyFormatSupport(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const useLegacyFormat = req.headers["x-legacy-format"] === "true";

  if (useLegacyFormat) {
    // Override response helpers to use legacy format
    const originalSuccess = res.apiSuccess;
    const originalError = res.apiError;
    const originalPaginated = res.apiPaginated;

    res.apiSuccess = function <T>(data: T): Response {
      return this.json({ success: true, data });
    };

    res.apiError = function (
      code: string,
      message: string,
      details?: Record<string, unknown>,
    ): Response {
      const statusCode = ERROR_STATUS_MAP[code as ErrorCode] || 500;
      return this.status(statusCode).json({
        success: false,
        error: message,
        code,
        details,
      });
    };

    res.apiPaginated = function <T>(
      data: T[],
      pagination: PaginationMeta,
    ): Response {
      return this.json({
        success: true,
        data,
        pagination: {
          next: pagination.nextCursor,
          hasMore: pagination.hasMore,
        },
      });
    };
  }

  next();
}

// ── Validation Error Formatter ────────────────────────────────────────────────

export function formatValidationErrors(
  errors: Array<{ field: string; message: string }>,
): Record<string, unknown> {
  return {
    validationErrors: errors,
    count: errors.length,
  };
}
