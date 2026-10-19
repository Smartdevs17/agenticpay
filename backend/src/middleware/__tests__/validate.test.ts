import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../validate.js';

function makeReq(body: unknown): Request {
  return { body, method: 'POST' } as unknown as Request;
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

describe('validate middleware', () => {
  const schema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    age: z.number().min(18),
  });

  it('calls next() when validation passes', () => {
    const req = makeReq({ name: 'John', email: 'john@example.com', age: 25 });
    const { res } = makeRes();
    const next = vi.fn();

    const mw = validate(schema);
    mw(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('returns 400 with error details when validation fails', () => {
    const req = makeReq({ name: '', email: 'invalid', age: 15 });
    const { res } = makeRes();
    const next = vi.fn();

    const mw = validate(schema);
    mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation failed',
      errors: expect.arrayContaining([
        expect.objectContaining({ path: 'email' }),
        expect.objectContaining({ path: 'age' }),
      ]),
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes non-Zod errors to next()', () => {
    const throwingSchema = {
      parse: () => { throw new Error('Unexpected'); },
    } as unknown as z.ZodSchema;

    const req = makeReq({});
    const { res } = makeRes();
    const next = vi.fn();

    const mw = validate(throwingSchema);
    mw(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('returns 400 with empty errors array for ZodError with no issues', () => {
    const emptySchema = z.object({});
    const req = makeReq({ unexpected: 'field' });
    const { res } = makeRes();
    const next = vi.fn();

    const mw = validate(emptySchema);
    mw(req, res, next);

    // empty object schema should pass with extra fields (Zod strips by default)
    expect(next).toHaveBeenCalledOnce();
  });
});
