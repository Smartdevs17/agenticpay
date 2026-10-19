import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { AppError, asyncHandler, notFoundHandler, errorHandler } from '../errorHandler.js';

function makeReq(overrides: Partial<Request> = {}): Request {
  return { method: 'GET', originalUrl: '/test', ...overrides } as unknown as Request;
}

function makeRes(): { res: Response; statusCode: number; body: unknown } {
  let statusCode = 200;
  let body: unknown = undefined;
  const res = {
    status: vi.fn(function (code: number) { statusCode = code; return res; }),
    json: vi.fn(function (data: unknown) { body = data; return res; }),
  } as unknown as Response;
  return { res, get statusCode() { return statusCode; }, get body() { return body; } };
}

describe('AppError', () => {
  it('creates an error with statusCode, message, and code', () => {
    const err = new AppError(404, 'Not found', 'NOT_FOUND', { resource: 'user' });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.details).toEqual({ resource: 'user' });
    expect(err.name).toBe('AppError');
  });

  it('defaults code to INTERNAL_SERVER_ERROR', () => {
    const err = new AppError(500, 'Server error');
    expect(err.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('defaults details to undefined', () => {
    const err = new AppError(400, 'Bad request');
    expect(err.details).toBeUndefined();
  });
});

describe('asyncHandler', () => {
  it('calls next with resolved value on success', async () => {
    const handler = asyncHandler(async (_req: Request, _res: Response) => 'done');
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    handler(req, res, next);

    await new Promise(process.nextTick);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next with error when handler rejects', async () => {
    const testError = new Error('async error');
    const handler = asyncHandler(async (_req: Request, _res: Response) => { throw testError; });
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    handler(req, res, next);

    await new Promise(process.nextTick);
    expect(next).toHaveBeenCalledWith(testError);
  });
});

describe('notFoundHandler', () => {
  it('creates a 404 AppError', () => {
    const req = makeReq({ method: 'POST', originalUrl: '/api/unknown' });
    const { res } = makeRes();
    const next = vi.fn();

    notFoundHandler(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0] as AppError;
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toContain('/api/unknown');
  });
});

describe('errorHandler', () => {
  let env: string | undefined;

  beforeEach(() => {
    env = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = env;
  });

  it('responds with structured error for AppError', () => {
    const err = new AppError(403, 'Forbidden', 'FORBIDDEN');
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'FORBIDDEN', message: 'Forbidden', status: 403 },
    });
  });

  it('responds with 500 for unknown errors', () => {
    const err = new Error('unexpected');
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('includes stack trace in non-production', () => {
    process.env.NODE_ENV = 'development';
    const err = new Error('dev error');
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    const callArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.error.stack).toBeDefined();
  });

  it('hides stack trace in production', () => {
    process.env.NODE_ENV = 'production';
    const err = new Error('prod error');
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    const callArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.error.stack).toBeUndefined();
  });

  it('includes details from AppError', () => {
    const err = new AppError(422, 'Validation failed', 'VALIDATION_ERROR', { field: 'email' });
    const req = makeReq();
    const { res } = makeRes();
    const next = vi.fn();

    errorHandler(err, req, res, next);

    const callArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.error.details).toEqual({ field: 'email' });
  });
});
