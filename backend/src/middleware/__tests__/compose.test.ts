import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { composeMiddleware, createMiddlewareChain } from '../compose.js';

function makeReq(overrides: Partial<Request> = {}): Request {
  return { method: 'GET', headers: {}, ...overrides } as unknown as Request;
}

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() } as unknown as Response;
}

describe('composeMiddleware', () => {
  it('executes middleware in order', () => {
    const order: number[] = [];
    const mw1 = (_req: Request, _res: Response, next: any) => { order.push(1); next(); };
    const mw2 = (_req: Request, _res: Response, next: any) => { order.push(2); next(); };
    const mw3 = (_req: Request, _res: Response, next: any) => { order.push(3); next(); };

    const composed = composeMiddleware(mw1, mw2, mw3);
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    composed(req, res, next);

    expect(order).toEqual([1, 2, 3]);
    expect(next).toHaveBeenCalledOnce();
  });

  it('handles async middleware', async () => {
    const order: number[] = [];
    const mw1 = async (_req: Request, _res: Response, next: any) => { order.push(1); next(); };
    const mw2 = async (_req: Request, _res: Response, next: any) => { order.push(2); next(); };

    const composed = composeMiddleware(mw1, mw2);
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    composed(req, res, next);

    await new Promise(process.nextTick);
    expect(order).toEqual([1, 2]);
  });

  it('passes errors to the outer next() callback', () => {
    const testError = new Error('middleware error');
    const mw1 = (_req: Request, _res: Response, next: any) => { next(testError); };

    const composed = composeMiddleware(mw1);
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    composed(req, res, next);

    expect(next).toHaveBeenCalledWith(testError);
  });

  it('catches thrown errors and forwards to next()', () => {
    const mw1 = (_req: Request, _res: Response, _next: any) => { throw new Error('thrown error'); };

    const composed = composeMiddleware(mw1);
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    composed(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('catches async rejections and forwards to next()', async () => {
    const mw1 = async (_req: Request, _res: Response, _next: any) => {
      throw new Error('async rejection');
    };

    const composed = composeMiddleware(mw1);
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    composed(req, res, next);

    await new Promise(process.nextTick);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('calls next() when no middleware is provided', () => {
    const composed = composeMiddleware();
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    composed(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});

describe('createMiddlewareChain', () => {
  it('builds and executes a chain', () => {
    const order: number[] = [];
    const chain = createMiddlewareChain()
      .use(
        (_req: Request, _res: Response, next: any) => { order.push(1); next(); },
        (_req: Request, _res: Response, next: any) => { order.push(2); next(); },
      )
      .use(
        (_req: Request, _res: Response, next: any) => { order.push(3); next(); },
      );

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    chain.execute(req, res, next);

    expect(order).toEqual([1, 2, 3]);
    expect(next).toHaveBeenCalledOnce();
  });

  it('supports chaining .use() multiple times on returned chain', () => {
    const order: number[] = [];
    const chain = createMiddlewareChain()
      .use((_req, _res, next) => { order.push(1); next(); });

    const chain2 = chain.use((_req, _res, next) => { order.push(2); next(); });

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    chain2.execute(req, res, next);

    expect(order).toEqual([1, 2]);
  });
});
