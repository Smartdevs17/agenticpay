import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { verifyWebhookProvider } from '../webhookVerification.js';
import { AppError } from '../errorHandler.js';
import { clearReplayCache } from '../../services/webhooks/replay.js';

const h = vi.hoisted(() => ({
  customResult: {} as Record<string, unknown>,
  stripeResult: {} as Record<string, unknown>,
  githubResult: {} as Record<string, unknown>,
  paypalResult: {} as Record<string, unknown>,
  retryResult: undefined as unknown,
  queueCalls: [] as unknown[],
}));

vi.mock('../../services/webhooks/verification.js', () => ({
  queueFailedWebhook: (...args: unknown[]) => {
    h.queueCalls.push(args);
    return { id: 'whe_test_1', provider: 'custom' };
  },
  retryWebhook: () => h.retryResult,
}));

vi.mock('../../services/stripe.js', () => ({
  constructWebhookEvent: () => {
    throw new Error('stripe not exercised in this suite');
  },
}));

vi.mock('../../services/webhooks/providers.js', () => ({
  verifyStripeProviderWebhook: () => h.stripeResult,
  verifyGithubProviderWebhook: () => h.githubResult,
  verifyPaypalProviderWebhook: () => h.paypalResult,
  verifyCustomProviderWebhook: () => h.customResult,
}));

const res = {} as Response;

function validResult(overrides: Record<string, unknown> = {}) {
  return {
    isValid: true,
    provider: 'custom',
    eventId: 'evt_dispatch_1',
    timestamp: new Date(),
    body: '{"a":1}',
    payload: { parsed: true },
    ...overrides,
  };
}

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    body: {},
    rawBody: '{"a":1}',
    ...overrides,
  } as unknown as Request;
}

function makeNext() {
  const calls: Array<Error | undefined> = [];
  const next: NextFunction = ((err?: unknown) => {
    calls.push(err as Error | undefined);
  }) as NextFunction;
  return { next, calls };
}

describe('verifyWebhookProvider dispatcher', () => {
  beforeEach(() => {
    clearReplayCache();
    h.queueCalls = [];
    h.retryResult = undefined;
    h.customResult = validResult();
    h.stripeResult = validResult();
    h.githubResult = validResult();
    h.paypalResult = validResult();
  });

  afterEach(() => {
    clearReplayCache();
  });

  it('passes valid results through and replaces the body with the parsed payload', async () => {
    const middleware = verifyWebhookProvider('custom');
    const req = makeRequest();
    const { next, calls } = makeNext();

    await middleware(req, res, next);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeUndefined();
    expect(req.webhookVerification?.isValid).toBe(true);
    expect(req.body).toEqual({ parsed: true });
  });

  it('keeps the request body when the result has no payload', async () => {
    h.customResult = validResult({ payload: undefined });
    const middleware = verifyWebhookProvider('custom');
    const req = makeRequest({ body: { original: true } });
    const { next, calls } = makeNext();

    await middleware(req, res, next);

    expect(calls[0]).toBeUndefined();
    expect(req.body).toEqual({ original: true });
    expect(h.queueCalls).toHaveLength(0);
  });

  it('rejects invalid results with 401 WEBHOOK_VERIFICATION_FAILED', async () => {
    h.customResult = validResult({ isValid: false, error: 'Signature verification failed' });
    const middleware = verifyWebhookProvider('custom');
    const { next, calls } = makeNext();

    await middleware(makeRequest(), res, next);

    expect(h.queueCalls).toHaveLength(1);
    expect(calls[0]).toBeInstanceOf(AppError);
    expect((calls[0] as AppError).statusCode).toBe(401);
  });

  it('throws 409 WEBHOOK_REPLAY on duplicate event deliveries', async () => {
    const middleware = verifyWebhookProvider('custom');
    const { next, calls } = makeNext();
    h.customResult = validResult({ eventId: 'evt_double' });

    await middleware(makeRequest({ headers: { 'x-webhook-id': 'evt_double' } }), res, next);
    expect(calls[0]).toBeUndefined();

    calls.length = 0;
    await middleware(makeRequest({ headers: { 'x-webhook-id': 'evt_double' } }), res, next);
    expect(calls[0]).toBeInstanceOf(AppError);
    expect((calls[0] as AppError).statusCode).toBe(409);
    expect((calls[0] as AppError).code).toBe('WEBHOOK_REPLAY');
  });

  it('revalidates and passes on timeout/network failures when a retry succeeds', async () => {
    h.customResult = validResult({ isValid: false, error: 'Verification failed: network timeout' });
    h.retryResult = { isValid: true };
    const middleware = verifyWebhookProvider('custom');
    const req = makeRequest();
    const { next, calls } = makeNext();

    await middleware(req, res, next);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeUndefined();
    expect(req.webhookVerification?.isValid).toBe(true);
    expect(req.body).toEqual({ parsed: true });
  });

  it('rejects with 401 when the retry also fails', async () => {
    h.customResult = validResult({ isValid: false, error: 'timeout after retries' });
    h.retryResult = { isValid: false };
    const middleware = verifyWebhookProvider('custom');
    const { next, calls } = makeNext();

    await middleware(makeRequest(), res, next);

    expect(calls[0]).toBeInstanceOf(AppError);
    expect((calls[0] as AppError).statusCode).toBe(401);
  });

  it('wires every provider through the dispatcher', async () => {
    for (const middleware of [verifyWebhookProvider('stripe'), verifyWebhookProvider('github'), verifyWebhookProvider('paypal')]) {
      const { next, calls } = makeNext();
      await middleware(makeRequest(), res, next);
      expect(calls[0]).toBeUndefined();
    }
  });
});