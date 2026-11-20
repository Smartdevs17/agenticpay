import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
// Imported by explicit path: `middleware/validate.js` is a stale compiled CJS file
// that vitest would resolve first, so these tests target the TypeScript source.
import { validateRequest, validate, strictSchema } from '../validate.ts';
import type { Request, Response, NextFunction } from 'express';

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  res.status.mockReturnValue(res);
  return res;
}

function run(middleware: ReturnType<typeof validateRequest>, req: Partial<Request>) {
  const res = makeRes();
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  middleware(req as Request, res, next);
  return { res, next };
}

const transferSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3),
});

describe('request validation at the REST boundary (#1488)', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('unknown keys are rejected', () => {
    it('rejects an extra body field and names it', () => {
      const req = { body: { amount: 10, currency: 'USD', isAdmin: true } };
      const { res, next } = run(validate(transferSchema), req);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_FAILED',
          details: [expect.objectContaining({ path: 'isAdmin' })],
        })
      );
    });

    it('rejects an extra query parameter', () => {
      const mw = validateRequest({ query: z.object({ page: z.string() }) });
      const { res, next } = run(mw, { query: { page: '1', debug: 'true' } as never });
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects an extra path parameter', () => {
      const mw = validateRequest({ params: z.object({ id: z.string() }) });
      const { res, next } = run(mw, { params: { id: 'a', other: 'b' } as never });
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('still accepts a body that matches exactly', () => {
      const { res, next } = run(validate(transferSchema), { body: { amount: 10, currency: 'USD' } });
      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('replaces req.body with the parsed value', () => {
      const req: Partial<Request> = { body: { amount: '5' as unknown as number, currency: 'USD' } };
      const coerced = z.object({ amount: z.coerce.number(), currency: z.string() });
      run(validate(coerced), req);
      expect(req.body).toEqual({ amount: 5, currency: 'USD' });
    });
  });

  describe('prototype-polluting keys are rejected at any depth', () => {
    const nestedSchema = z.object({ meta: z.object({ note: z.string() }).passthrough() });

    it.each([
      ['top-level __proto__', JSON.parse('{"__proto__":{"x":1}}')],
      ['nested constructor', { meta: { constructor: 'x', note: 'hi' } }],
      ['nested prototype in an array', { meta: { note: 'hi', list: [{ prototype: 1 }] } }],
    ])('%s', (_label, body) => {
      const { res, next } = run(validate(nestedSchema), { body });
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ details: [expect.objectContaining({ message: 'Forbidden key' })] })
      );
    });
  });

  describe('error responses', () => {
    it('never echoes submitted values', () => {
      const { res } = run(validate(transferSchema), {
        body: { amount: 'secret-value-123', currency: 'USD' },
      });
      const payload = JSON.stringify(res.json.mock.calls[0][0]);
      expect(payload).not.toContain('secret-value-123');
      expect(payload).toContain('amount');
    });

    it('logs the target and field paths, not the values', () => {
      run(validate(transferSchema), { body: { amount: 'secret-value-456', currency: 'USD', extra: 1 } });
      const logged = warn.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(logged).toContain('request.validation_failed');
      expect(logged).toContain('"target":"body"');
      expect(logged).toContain('extra');
      expect(logged).not.toContain('secret-value-456');
    });

    it('returns the generic message', () => {
      const { res } = run(validate(transferSchema), { body: {} });
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Request validation failed' }));
    });
  });

  describe('strictSchema', () => {
    it('makes object schemas strict', () => {
      const strict = strictSchema(z.object({ a: z.string() }));
      expect(strict.safeParse({ a: 'x', b: 'y' }).success).toBe(false);
    });

    it('leaves non-object schemas unchanged', () => {
      const union = z.union([z.string(), z.number()]);
      expect(strictSchema(union)).toBe(union);
    });
  });

  it('validates only the targets that were configured', () => {
    const { next } = run(validate(transferSchema), {
      body: { amount: 1, currency: 'USD' },
      query: { anything: 'goes' } as never,
    });
    expect(next).toHaveBeenCalledWith();
  });
});
