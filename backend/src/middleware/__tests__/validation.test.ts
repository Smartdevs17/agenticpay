import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { commonSchemas, validateAndSanitize } from '../validation.js';

function req(overrides: Partial<Request>): Request {
  return {
    body: {},
    query: {},
    params: {},
    headers: {},
    ...overrides,
  } as Request;
}

describe('validation middleware', () => {
  it('sanitizes and validates body, query, and params', () => {
    const request = req({
      body: { email: ' USER@EXAMPLE.COM ', note: '<script>alert(1)</script>paid' },
      query: { page: '2', limit: '10' },
      params: { id: 'payment_123' },
    });
    const next = vi.fn();

    validateAndSanitize({
      body: z.object({
        email: commonSchemas.email,
        note: z.string().max(100),
      }),
      query: commonSchemas.pagination,
      params: z.object({ id: commonSchemas.id }),
    })(request, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(request.body.email).toBe('user@example.com');
    expect(request.body.note).not.toContain('<script>');
    expect(request.query.page).toBe(2);
    expect(request.params.id).toBe('payment_123');
  });

  it('passes formatted validation errors to error middleware', () => {
    const request = req({ body: { amount: '-1' } });
    const next = vi.fn();

    validateAndSanitize({
      body: z.object({ amount: commonSchemas.amount }),
    })(request, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      code: 'ERR_VALIDATION_FAILED',
    }));
  });
});
