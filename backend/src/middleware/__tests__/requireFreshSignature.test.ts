import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  requireFreshSignature,
  registerFreshSignatureKey,
  clearFreshSignatureKeys,
  clearFreshSignatureNonces,
  signFreshRequest,
  highValueThreshold,
  DEFAULT_HIGH_VALUE_THRESHOLD,
  FRESH_SIGNATURE_MAX_AGE_MS,
  FRESH_SIGNATURE_MAX_SKEW_MS,
} from '../requireFreshSignature.js';

const SECRET = 'a'.repeat(40);
const SIGNER = 'alice';
const NOW = 1_800_000_000_000;
const PATH = '/api/v1/withdrawals/wallet-1/requests';
const THRESHOLD = 10_000;
const BODY = { toAddress: 'GABC', amount: 25_000, currency: 'XLM', requestedBy: SIGNER };

function makeReq(overrides: Partial<Request> & { headers?: Record<string, string> } = {}): Request {
  return {
    method: 'POST',
    path: '/wallet-1/requests',
    originalUrl: PATH,
    url: '/wallet-1/requests',
    body: BODY,
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function run(middleware: ReturnType<typeof requireFreshSignature>, req: Request) {
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  middleware(req, {} as Response, next);
  return next;
}

interface ErrorShape { statusCode: number; code: string; message: string }

/** Asserts `next` received an error and returns it. Shape-checked because the app and tests can load separate module instances. */
function errorFrom(next: ReturnType<typeof vi.fn>): ErrorShape {
  const arg = next.mock.calls[0]?.[0] as ErrorShape | undefined;
  expect(arg).toBeDefined();
  expect(typeof arg?.statusCode).toBe('number');
  expect(typeof arg?.code).toBe('string');
  return arg as ErrorShape;
}

const middleware = requireFreshSignature({
  signerOf: (req) => req.body?.requestedBy,
  amountOf: (req) => req.body?.amount,
  threshold: () => THRESHOLD,
  now: () => NOW,
});

function signedHeaders(overrides: { timestamp?: number; nonce?: string; body?: unknown; secret?: string } = {}) {
  return signFreshRequest({
    secret: overrides.secret ?? SECRET,
    method: 'POST',
    path: PATH,
    body: overrides.body ?? BODY,
    timestamp: overrides.timestamp ?? NOW,
    nonce: overrides.nonce ?? 'nonce-0123456789abcdef',
  });
}

describe('requireFreshSignature (#1486)', () => {
  beforeEach(() => {
    clearFreshSignatureKeys();
    clearFreshSignatureNonces();
    registerFreshSignatureKey(SIGNER, SECRET);
  });

  describe('threshold', () => {
    it('does not require a signature below the threshold', () => {
      const next = run(middleware, makeReq({ body: { ...BODY, amount: THRESHOLD - 1 } }));
      expect(next).toHaveBeenCalledWith();
    });

    it('requires a signature at exactly the threshold', () => {
      const next = run(middleware, makeReq({ body: { ...BODY, amount: THRESHOLD } }));
      expect(errorFrom(next).code).toBe('FRESH_SIGNATURE_REQUIRED');
    });

    it('does not gate requests without an amount (validation rejects them later)', () => {
      const next = run(middleware, makeReq({ body: { requestedBy: SIGNER } }));
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('happy path', () => {
    it('accepts a correctly signed high-value request', () => {
      const req = makeReq({ headers: signedHeaders() as Record<string, string> });
      const next = run(middleware, req);
      expect(next).toHaveBeenCalledWith();
    });

    it('accepts a signature whose timestamp is slightly in the future (clock skew)', () => {
      const ts = NOW + FRESH_SIGNATURE_MAX_SKEW_MS;
      const next = run(middleware, makeReq({ headers: signedHeaders({ timestamp: ts }) as Record<string, string> }));
      expect(next).toHaveBeenCalledWith();
    });

    it('accepts a signature at the oldest allowed age', () => {
      const ts = NOW - FRESH_SIGNATURE_MAX_AGE_MS;
      const next = run(middleware, makeReq({ headers: signedHeaders({ timestamp: ts }) as Record<string, string> }));
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('rejections', () => {
    it('rejects when no fresh-signature headers are present', () => {
      const next = run(middleware, makeReq());
      expect(errorFrom(next)).toMatchObject({ statusCode: 401, code: 'FRESH_SIGNATURE_REQUIRED' });
    });

    it('rejects when only some headers are present', () => {
      const headers = signedHeaders();
      const next = run(middleware, makeReq({ headers: { 'x-fresh-signature': headers['x-fresh-signature'] } as Record<string, string> }));
      expect(errorFrom(next).code).toBe('FRESH_SIGNATURE_INCOMPLETE');
    });

    it('rejects when the signer has no registered key (fail closed)', () => {
      clearFreshSignatureKeys();
      const next = run(middleware, makeReq({ headers: signedHeaders() as Record<string, string> }));
      expect(errorFrom(next)).toMatchObject({ statusCode: 401, code: 'FRESH_SIGNATURE_UNKNOWN_SIGNER' });
    });

    it('rejects a timestamp older than the window (expired)', () => {
      const ts = NOW - FRESH_SIGNATURE_MAX_AGE_MS - 1;
      const next = run(middleware, makeReq({ headers: signedHeaders({ timestamp: ts }) as Record<string, string> }));
      expect(errorFrom(next).code).toBe('FRESH_SIGNATURE_EXPIRED');
    });

    it('rejects a timestamp too far in the future', () => {
      const ts = NOW + FRESH_SIGNATURE_MAX_SKEW_MS + 1;
      const next = run(middleware, makeReq({ headers: signedHeaders({ timestamp: ts }) as Record<string, string> }));
      expect(errorFrom(next).code).toBe('FRESH_SIGNATURE_EXPIRED');
    });

    it('rejects a non-numeric timestamp', () => {
      const headers = { ...signedHeaders(), 'x-fresh-timestamp': 'yesterday' } as Record<string, string>;
      const next = run(middleware, makeReq({ headers }));
      expect(errorFrom(next).code).toBe('FRESH_SIGNATURE_INVALID');
    });

    it('rejects a signature made with a different key', () => {
      const next = run(middleware, makeReq({ headers: signedHeaders({ secret: 'b'.repeat(40) }) as Record<string, string> }));
      expect(errorFrom(next).code).toBe('FRESH_SIGNATURE_INVALID');
    });

    it('rejects a signature over a different body (amount tampering)', () => {
      const headers = signedHeaders({ body: { ...BODY, amount: 99_999 } }) as Record<string, string>;
      const next = run(middleware, makeReq({ headers }));
      expect(errorFrom(next).code).toBe('FRESH_SIGNATURE_INVALID');
    });

    it('rejects a signature replayed against a different path', () => {
      const headers = signFreshRequest({
        secret: SECRET,
        method: 'POST',
        path: '/api/v1/withdrawals/other-wallet/requests',
        body: BODY,
        timestamp: NOW,
        nonce: 'nonce-0123456789abcdef',
      }) as Record<string, string>;
      const next = run(middleware, makeReq({ headers }));
      expect(errorFrom(next).code).toBe('FRESH_SIGNATURE_INVALID');
    });

    it('rejects a malformed signature value', () => {
      const headers = { ...signedHeaders(), 'x-fresh-signature': 'not-hex' } as Record<string, string>;
      const next = run(middleware, makeReq({ headers }));
      expect(errorFrom(next).code).toBe('FRESH_SIGNATURE_INVALID');
    });

    it('rejects a malformed nonce', () => {
      const next = run(middleware, makeReq({ headers: signedHeaders({ nonce: 'short' }) as Record<string, string> }));
      expect(errorFrom(next).code).toBe('FRESH_SIGNATURE_INVALID');
    });

    it('rejects a second use of the same signed request (replay)', () => {
      const headers = signedHeaders() as Record<string, string>;
      const first = run(middleware, makeReq({ headers }));
      expect(first).toHaveBeenCalledWith();

      const second = run(middleware, makeReq({ headers }));
      expect(errorFrom(second)).toMatchObject({ statusCode: 409, code: 'FRESH_SIGNATURE_REPLAYED' });
    });

    it('treats a non-numeric amount as high-value so it cannot skip the check', () => {
      const gated = requireFreshSignature({
        signerOf: (req) => req.body?.requestedBy,
        amountOf: () => Number.POSITIVE_INFINITY,
        threshold: () => THRESHOLD,
        now: () => NOW,
      });
      const next = run(gated, makeReq());
      expect(errorFrom(next).code).toBe('FRESH_SIGNATURE_REQUIRED');
    });
  });

  describe('threshold configuration', () => {
    const original = process.env.HIGH_VALUE_WITHDRAWAL_THRESHOLD;
    beforeEach(() => {
      delete process.env.HIGH_VALUE_WITHDRAWAL_THRESHOLD;
    });

    it('defaults to DEFAULT_HIGH_VALUE_THRESHOLD', () => {
      expect(highValueThreshold()).toBe(DEFAULT_HIGH_VALUE_THRESHOLD);
    });

    it('reads HIGH_VALUE_WITHDRAWAL_THRESHOLD when it is a positive number', () => {
      process.env.HIGH_VALUE_WITHDRAWAL_THRESHOLD = '500';
      expect(highValueThreshold()).toBe(500);
    });

    it('ignores invalid overrides and falls back to the default', () => {
      for (const bad of ['abc', '0', '-5']) {
        process.env.HIGH_VALUE_WITHDRAWAL_THRESHOLD = bad;
        expect(highValueThreshold()).toBe(DEFAULT_HIGH_VALUE_THRESHOLD);
      }
    });

    afterAll(() => {
      if (original === undefined) delete process.env.HIGH_VALUE_WITHDRAWAL_THRESHOLD;
      else process.env.HIGH_VALUE_WITHDRAWAL_THRESHOLD = original;
    });
  });

  it('refuses to register a secret shorter than 32 characters', () => {
    expect(() => registerFreshSignatureKey('bob', 'short')).toThrow(/at least 32/);
  });
});
