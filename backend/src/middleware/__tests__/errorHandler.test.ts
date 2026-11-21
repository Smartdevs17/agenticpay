import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import {
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  BlockchainError,
  asyncHandler,
  notFoundHandler,
  errorHandler,
  mapPrismaError,
  normalizeErrorCode,
} from '../errorHandler.js';
import { formatEdgeError } from '../../../../workers/src/errors.js';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    originalUrl: '/test',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): { res: Response; statusCode: number; body: any } {
  let statusCode = 200;
  let body: any = undefined;
  const res = {
    status: vi.fn(function (code: number) {
      statusCode = code;
      return res;
    }),
    json: vi.fn(function (data: unknown) {
      body = data;
      return res;
    }),
  } as unknown as Response;
  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

describe('Issue #1402: Unified Error Response Contract Tests', () => {
  let env: string | undefined;

  beforeEach(() => {
    env = process.env.NODE_ENV;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = env;
  });

  describe('AppError hierarchy and sub-classes', () => {
    it('creates standard AppError with defaults', () => {
      const err = new AppError(400, 'Bad request');
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('ERR_INTERNAL');
      expect(err.isOperational).toBe(true);
    });

    it('creates ValidationError with status 400 and ERR_VALIDATION_FAILED', () => {
      const err = new ValidationError('Invalid input', { field: 'amount' });
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('ERR_VALIDATION_FAILED');
      expect(err.details).toEqual({ field: 'amount' });
    });

    it('creates AuthError with status 401 and ERR_AUTH_UNAUTHENTICATED', () => {
      const err = new AuthError();
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('ERR_AUTH_UNAUTHENTICATED');
    });

    it('creates ForbiddenError with status 403 and ERR_AUTH_FORBIDDEN', () => {
      const err = new ForbiddenError();
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('ERR_AUTH_FORBIDDEN');
    });

    it('creates NotFoundError with status 404 and ERR_RESOURCE_NOT_FOUND', () => {
      const err = new NotFoundError('Invoice not found');
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('ERR_RESOURCE_NOT_FOUND');
    });

    it('creates ConflictError with status 409 and ERR_CONFIG_CONFLICT', () => {
      const err = new ConflictError();
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('ERR_CONFIG_CONFLICT');
    });

    it('creates RateLimitError with status 429, code ERR_RATE_LIMIT_EXCEEDED, and retryAfter', () => {
      const err = new RateLimitError('Too many requests', 60);
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe('ERR_RATE_LIMIT_EXCEEDED');
      expect(err.retryAfter).toBe(60);
    });

    it('creates BlockchainError with status 502 and ERR_BLOCKCHAIN_TRANSACTION_FAILED', () => {
      const err = new BlockchainError('Horizon submission timed out');
      expect(err.statusCode).toBe(502);
      expect(err.code).toBe('ERR_BLOCKCHAIN_TRANSACTION_FAILED');
    });
  });

  describe('normalizeErrorCode', () => {
    it('preserves modern ERR_ prefixed codes', () => {
      expect(normalizeErrorCode('ERR_VALIDATION_FAILED', 400)).toBe('ERR_VALIDATION_FAILED');
    });

    it('maps legacy codes to canonical codes', () => {
      expect(normalizeErrorCode('VALIDATION_ERROR', 400)).toBe('ERR_VALIDATION_FAILED');
      expect(normalizeErrorCode('NOT_FOUND', 404)).toBe('ERR_RESOURCE_NOT_FOUND');
      expect(normalizeErrorCode('UNAUTHORIZED', 401)).toBe('ERR_AUTH_UNAUTHENTICATED');
      expect(normalizeErrorCode('RATE_LIMIT_EXCEEDED', 429)).toBe('ERR_RATE_LIMIT_EXCEEDED');
    });

    it('falls back to status code mapping when code is unknown', () => {
      expect(normalizeErrorCode(undefined, 404)).toBe('ERR_RESOURCE_NOT_FOUND');
      expect(normalizeErrorCode(undefined, 429)).toBe('ERR_RATE_LIMIT_EXCEEDED');
      expect(normalizeErrorCode(undefined, 500)).toBe('ERR_INTERNAL');
    });
  });

  describe('mapPrismaError', () => {
    it('maps Prisma P2002 to ConflictError', () => {
      const err = mapPrismaError({ code: 'P2002', message: 'Unique constraint' });
      expect(err).toBeInstanceOf(ConflictError);
      expect(err?.statusCode).toBe(409);
      expect(err?.code).toBe('ERR_CONFIG_CONFLICT');
    });

    it('maps Prisma P2025 to NotFoundError', () => {
      const err = mapPrismaError({ code: 'P2025', message: 'Record not found' });
      expect(err).toBeInstanceOf(NotFoundError);
      expect(err?.statusCode).toBe(404);
      expect(err?.code).toBe('ERR_RESOURCE_NOT_FOUND');
    });

    it('maps Prisma P2003 to ValidationError', () => {
      const err = mapPrismaError({ code: 'P2003', message: 'Foreign key failure' });
      expect(err).toBeInstanceOf(ValidationError);
      expect(err?.statusCode).toBe(400);
      expect(err?.code).toBe('ERR_VALIDATION_FAILED');
    });

    it('maps PrismaClientValidationError to ValidationError', () => {
      const err = mapPrismaError({ name: 'PrismaClientValidationError', message: 'Missing field' });
      expect(err).toBeInstanceOf(ValidationError);
      expect(err?.statusCode).toBe(400);
    });

    it('returns null for non-Prisma errors', () => {
      expect(mapPrismaError(new Error('Normal error'))).toBeNull();
    });
  });

  describe('errorHandler response shape and headers', () => {
    it('returns structured unified error for AppError with requestId', () => {
      const err = new NotFoundError('Invoice #123 not found', { invoiceId: '123' });
      const req = makeReq({ headers: { 'x-request-id': 'req-abc-999' } });
      const { res } = makeRes();
      const next = vi.fn();

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: {
          code: 'ERR_RESOURCE_NOT_FOUND',
          message: 'Invoice #123 not found',
          status: 404,
          details: { invoiceId: '123' },
          requestId: 'req-abc-999',
        },
      });
    });

    it('includes retryAfter for rate limit errors', () => {
      const err = new RateLimitError('Too many requests', 45);
      const req = makeReq();
      const { res } = makeRes();
      const next = vi.fn();

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(payload.error.code).toBe('ERR_RATE_LIMIT_EXCEEDED');
      expect(payload.error.status).toBe(429);
      expect(payload.error.retryAfter).toBe(45);
    });

    it('safely handles unknown 500 error in production without leaking message or stack', () => {
      process.env.NODE_ENV = 'production';
      const err = new Error('Database connection failed with password=secret123');
      const req = makeReq();
      const { res } = makeRes();
      const next = vi.fn();

      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(payload.error.code).toBe('ERR_INTERNAL');
      expect(payload.error.status).toBe(500);
      expect(payload.error.message).toBe('Internal server error');
      expect(payload.error.stack).toBeUndefined();
    });

    it('maps Prisma errors through the errorHandler', () => {
      const prismaErr = { code: 'P2002', message: 'Unique constraint on payment_hash' };
      const req = makeReq();
      const { res } = makeRes();
      const next = vi.fn();

      errorHandler(prismaErr, req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(payload.error.code).toBe('ERR_CONFIG_CONFLICT');
      expect(payload.error.status).toBe(409);
    });
  });

  describe('Workers edge adapter shape parity', () => {
    it('produces identical error envelope in worker adapter', () => {
      const edgeResponse = formatEdgeError({
        code: 'ERR_AUTH_UNAUTHENTICATED',
        message: 'Authentication required',
        status: 401,
        requestId: 'req-edge-1',
      });

      expect(edgeResponse).toEqual({
        error: {
          code: 'ERR_AUTH_UNAUTHENTICATED',
          message: 'Authentication required',
          status: 401,
          requestId: 'req-edge-1',
        },
      });
    });

    it('translates legacy worker codes into canonical codes', () => {
      const edgeResponse = formatEdgeError({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests',
        status: 429,
        retryAfter: 30,
      });

      expect(edgeResponse.error.code).toBe('ERR_RATE_LIMIT_EXCEEDED');
      expect(edgeResponse.error.status).toBe(429);
      expect(edgeResponse.error.retryAfter).toBe(30);
    });
  });

  describe('asyncHandler and notFoundHandler', () => {
    it('forwards async rejections to next()', async () => {
      const testErr = new Error('Async failure');
      const handler = asyncHandler(async () => {
        throw testErr;
      });
      const req = makeReq();
      const { res } = makeRes();
      const next = vi.fn();

      handler(req, res, next);
      await new Promise(process.nextTick);

      expect(next).toHaveBeenCalledWith(testErr);
    });

    it('notFoundHandler calls next with NotFoundError', () => {
      const req = makeReq({ method: 'GET', originalUrl: '/non-existent' });
      const { res } = makeRes();
      const next = vi.fn();

      notFoundHandler(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      const err = next.mock.calls[0][0] as AppError;
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('ERR_RESOURCE_NOT_FOUND');
    });
  });
});
