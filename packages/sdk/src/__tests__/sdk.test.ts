/**
 * Tests for the AgenticPay TypeScript SDK.
 */
import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  AgenticPaySDK,
  createAgenticPaySDK,
  AgenticPayError,
  AuthenticationError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  NetworkError,
} from '../index.js';
import { MockAgenticPayServer, createTestSDK, expectApiError } from '../testing.js';
import type { MockServerInstance } from '../testing/types.js';

let server: MockServerInstance;

beforeAll(async () => {
  server = await MockAgenticPayServer.create();
});

afterAll(async () => {
  await server.close();
});

// ─── SDK Construction ─────────────────────────────────────────────────────────

describe('AgenticPaySDK', () => {
  it('creates an SDK instance with all services', () => {
    const sdk = new AgenticPaySDK({
      baseUrl: 'http://localhost:3001/api/v1',
      apiKey: 'test_key',
    });

    expect(sdk.payments).toBeDefined();
    expect(sdk.refunds).toBeDefined();
    expect(sdk.verification).toBeDefined();
    expect(sdk.featureFlags).toBeDefined();
    expect(sdk.subscriptions).toBeDefined();
    expect(sdk.invoices).toBeDefined();
    expect(sdk.escrow).toBeDefined();
    expect(sdk.disputes).toBeDefined();
    expect(sdk.stellar).toBeDefined();
    expect(sdk.sandbox).toBeDefined();
  });

  it('creates via factory function', () => {
    const sdk = createAgenticPaySDK({
      baseUrl: 'http://localhost:3001/api/v1',
      apiKey: 'test_key',
    });
    expect(sdk).toBeInstanceOf(AgenticPaySDK);
  });
});

// ─── Error Handling ───────────────────────────────────────────────────────────

describe('Error Classes', () => {
  it('AuthenticationError has correct status', () => {
    const err = new AuthenticationError();
    expect(err.status).toBe(401);
    expect(err.code).toBe('AUTHENTICATION_ERROR');
    expect(err).toBeInstanceOf(AgenticPayError);
  });

  it('ValidationError has correct status', () => {
    const err = new ValidationError('bad input', { field: 'name' });
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual({ field: 'name' });
  });

  it('NotFoundError has correct status', () => {
    const err = new NotFoundError('not found');
    expect(err.status).toBe(404);
  });

  it('RateLimitError has correct status', () => {
    const err = new RateLimitError();
    expect(err.status).toBe(429);
  });

  it('NetworkError has no status', () => {
    const err = new NetworkError();
    expect(err.status).toBeUndefined();
    expect(err.code).toBe('NETWORK_ERROR');
  });
});

// ─── Mock Server Integration ──────────────────────────────────────────────────

describe('MockAgenticPayServer', () => {
  it('responds to configured routes', async () => {
    server.addRoute({
      method: 'GET',
      path: '/health',
      body: { status: 'ok' },
    });

    const sdk = createTestSDK({ baseUrl: server.url });
    const response = await fetch(`${server.url}/health`);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
    server.resetRoutes();
  });

  it('records requests', async () => {
    server.addRoute({
      method: 'POST',
      path: '/test',
      body: { ok: true },
    });

    await fetch(`${server.url}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'value' }),
    });

    const lastReq = server.getLastRequest();
    expect(lastReq).toBeDefined();
    expect(lastReq!.method).toBe('POST');
    expect(lastReq!.path).toBe('/test');
    expect(lastReq!.body).toEqual({ key: 'value' });
    server.resetRoutes();
    server.resetRequests();
  });

  it('returns 404 for unmatched routes', async () => {
    server.resetRoutes();
    const response = await fetch(`${server.url}/nonexistent`);
    expect(response.status).toBe(404);
  });
});

// ─── Verification API ─────────────────────────────────────────────────────────

describe('VerificationApi', () => {
  it('sends verification request', async () => {
    const expectedResponse = { id: 'v_1', status: 'verified', score: 95 };
    server.resetRoutes();
    server.addRoute({
      method: 'POST',
      path: '/verification/verify',
      body: expectedResponse,
    });

    const sdk = createTestSDK({ baseUrl: server.url });
    const result = await sdk.verification.verifyWork({
      repositoryUrl: 'https://github.com/user/repo',
      milestoneDescription: 'Build login page',
      projectId: 'proj_1',
    });

    expect(result).toEqual(expectedResponse);
    const req = server.getLastRequest()!;
    expect(req.body).toMatchObject({
      repositoryUrl: 'https://github.com/user/repo',
      milestoneDescription: 'Build login page',
      projectId: 'proj_1',
    });
  });

  it('handles batch verification', async () => {
    server.resetRoutes();
    server.addRoute({
      method: 'POST',
      path: '/verification/verify/batch',
      body: { results: [{ id: 'v_1' }, { id: 'v_2' }] },
    });

    const sdk = createTestSDK({ baseUrl: server.url });
    const result = await sdk.verification.verifyWorkBatch([
      { repositoryUrl: 'url1', milestoneDescription: 'desc1', projectId: 'p1' },
      { repositoryUrl: 'url2', milestoneDescription: 'desc2', projectId: 'p2' },
    ]);

    expect(result).toEqual({ results: [{ id: 'v_1' }, { id: 'v_2' }] });
  });
});

// ─── Subscription API ─────────────────────────────────────────────────────────

describe('SubscriptionsApi', () => {
  it('creates a plan', async () => {
    server.resetRoutes();
    server.addRoute({
      method: 'POST',
      path: '/plans',
      body: { id: 'plan_1', name: 'Pro', isActive: true },
    });

    const sdk = createTestSDK({ baseUrl: server.url });
    const result = await sdk.subscriptions.createPlan({
      merchantId: 'm_1',
      name: 'Pro',
      interval: 'monthly',
      amount: 29.99,
      currency: 'USD',
    });

    expect(result).toEqual({ id: 'plan_1', name: 'Pro', isActive: true });
  });

  it('enrolls a subscription', async () => {
    server.resetRoutes();
    server.addRoute({
      method: 'POST',
      path: '/subscriptions/enroll',
      body: { id: 'sub_1', status: 'active' },
    });

    const sdk = createTestSDK({ baseUrl: server.url });
    const result = await sdk.subscriptions.enroll({
      customerId: 'cus_1',
      planId: 'plan_1',
    });

    expect(result).toEqual({ id: 'sub_1', status: 'active' });
  });
});

// ─── Escrow API ───────────────────────────────────────────────────────────────

describe('EscrowApi', () => {
  it('creates an escrow', async () => {
    server.resetRoutes();
    server.addRoute({
      method: 'POST',
      path: '/escrow',
      body: { id: 'esc_1', status: 'draft' },
    });

    const sdk = createTestSDK({ baseUrl: server.url });
    const result = await sdk.escrow.create({
      projectId: 'proj_1',
      payerId: 'payer_1',
      payeeId: 'payee_1',
      currency: 'XLM',
      totalAmount: 1000,
      milestones: [{ title: 'Phase 1', amount: 1000, completionCriteria: 'Done' }],
    });

    expect(result).toEqual({ id: 'esc_1', status: 'draft' });
  });

  it('funds an escrow', async () => {
    server.resetRoutes();
    server.addRoute({
      method: 'POST',
      path: '/escrow/esc_1/fund',
      body: { id: 'esc_1', status: 'funded', fundedAmount: 1000 },
    });

    const sdk = createTestSDK({ baseUrl: server.url });
    const result = await sdk.escrow.fund('esc_1', { amount: 1000 });

    expect(result).toMatchObject({ id: 'esc_1', status: 'funded' });
  });
});

// ─── Error Handling via Mock ──────────────────────────────────────────────────

describe('Error handling via mock server', () => {
  it('throws NotFoundError on 404', async () => {
    server.resetRoutes();
    server.addRoute({
      method: 'GET',
      path: '/escrow/nonexistent',
      status: 404,
      body: { error: { message: 'Escrow not found' } },
    });

    const sdk = createTestSDK({ baseUrl: server.url });
    try {
      await sdk.escrow.get('nonexistent');
      expect.fail('Should have thrown');
    } catch (err) {
      const apiError = expectApiError(err, 404);
      expect(apiError.message).toBe('Escrow not found');
    }
  });

  it('throws ValidationError on 400', async () => {
    server.resetRoutes();
    server.addRoute({
      method: 'POST',
      path: '/verification/verify',
      status: 400,
      body: { error: { message: 'Invalid repository URL' } },
    });

    const sdk = createTestSDK({ baseUrl: server.url });
    try {
      await sdk.verification.verifyWork({
        repositoryUrl: '',
        milestoneDescription: '',
        projectId: '',
      });
      expect.fail('Should have thrown');
    } catch (err) {
      const apiError = expectApiError(err, 400);
      expect(apiError.message).toBe('Invalid repository URL');
    }
  });
});

// ─── Feature Flags API ────────────────────────────────────────────────────────

describe('FeatureFlagsApi', () => {
  it('evaluates a feature flag', async () => {
    server.resetRoutes();
    server.addRoute({
      method: 'GET',
      path: '/flags/evaluate',
      body: { flag: 'test-flag', identifier: 'user_1', enabled: true, variant: 'v_promo' },
    });

    const sdk = createTestSDK({ baseUrl: server.url });
    const result = await sdk.featureFlags.evaluate('test-flag', 'user_1');

    expect(result).toEqual({ flag: 'test-flag', identifier: 'user_1', enabled: true, variant: 'v_promo' });
    const lastReq = server.getLastRequest();
    expect(lastReq?.path).toContain('/flags/evaluate');
    expect(lastReq?.path).toContain('flag=test-flag');
    expect(lastReq?.path).toContain('identifier=user_1');
  });

  it('fetches feature flags state', async () => {
    server.resetRoutes();
    server.addRoute({
      method: 'GET',
      path: '/flags/state',
      body: { identifier: 'user_1', flags: { 'test-flag': true, 'another-flag': 'v_b' } },
    });

    const sdk = createTestSDK({ baseUrl: server.url });
    const result = await sdk.featureFlags.state('user_1');

    expect(result).toEqual({ identifier: 'user_1', flags: { 'test-flag': true, 'another-flag': 'v_b' } });
  });

  it('records client-side exposure', async () => {
    server.resetRoutes();
    server.addRoute({
      method: 'POST',
      path: '/flags/exposure',
      body: { recorded: true },
    });

    const sdk = createTestSDK({ baseUrl: server.url });
    const result = await sdk.featureFlags.recordExposure('test-flag', 'user_1', 'v_promo');

    expect(result).toEqual({ recorded: true });
    const lastReq = server.getLastRequest();
    expect(lastReq?.body).toEqual({ flag: 'test-flag', identifier: 'user_1', value: 'v_promo' });
  });
});


// ─── Test Helpers ─────────────────────────────────────────────────────────────

describe('expectApiError', () => {
  it('passes for correct error type', () => {
    const err = new AuthenticationError('bad');
    const result = expectApiError(err, 401);
    expect(result).toBe(err);
  });

  it('throws for wrong error type', () => {
    expect(() => expectApiError(new Error('generic'))).toThrow('Expected AgenticPayError');
  });

  it('throws for wrong status', () => {
    const err = new ValidationError('bad');
    expect(() => expectApiError(err, 500)).toThrow('Expected error with status 500');
  });
});
