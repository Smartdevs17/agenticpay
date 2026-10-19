import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import { payoutsRouter } from '../payouts.js';
import { payoutEngine } from '../../services/payouts/payout-engine.js';
import { errorHandler } from '../../middleware/errorHandler.js';
import { clearIdempotencyCache } from '../../middleware/idempotency.js';

const APPROVER = { 'x-actor-id': 'fin_1', 'x-actor-role': 'finance_approver' };

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/payouts', payoutsRouter);
  app.use(errorHandler);
  return app;
}

async function testRequest(
  app: Express,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body: body as any, headers: res.headers };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function fundMerchant(app: Express, merchantId: string, amount: number) {
  return testRequest(app, `/api/v1/payouts/balances/${merchantId}`, {
    method: 'POST',
    headers: APPROVER,
    body: { amount },
  });
}

describe('Payout routes (/api/v1/payouts)', () => {
  let app: Express;

  beforeEach(() => {
    clearIdempotencyCache();
    payoutEngine.reset();
    app = createTestApp();
  });

  afterEach(() => {
    payoutEngine.reset();
    clearIdempotencyCache();
  });

  describe('authentication', () => {
    it('rejects an unauthenticated schedule write', async () => {
      const res = await testRequest(app, '/api/v1/payouts/schedules/merch_route', {
        method: 'PUT',
        body: { scheduleType: 'daily', preferredAsset: 'USDC', autoApproveLimit: 100 },
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('ERR_AUTH_UNAUTHENTICATED');
    });

    it('rejects an authenticated principal without an approver role', async () => {
      const res = await testRequest(app, '/api/v1/payouts/schedules/merch_route', {
        method: 'PUT',
        headers: { 'x-actor-id': 'usr_9', 'x-actor-role': 'merchant' },
        body: { scheduleType: 'daily', preferredAsset: 'USDC', autoApproveLimit: 100 },
      });

      expect(res.status).toBe(401);
    });

    it('rejects an unauthenticated balance credit', async () => {
      const res = await testRequest(app, '/api/v1/payouts/balances/merch_route', {
        method: 'POST',
        body: { amount: 100 },
      });

      expect(res.status).toBe(401);
    });

    it('rejects an unauthenticated read of a batch', async () => {
      const res = await testRequest(app, '/api/v1/payouts/po_does_not_exist');

      expect(res.status).toBe(401);
      // The rejection happens before the lookup, so no existence signal is leaked.
      expect(res.body.error.code).toBe('ERR_AUTH_UNAUTHENTICATED');
    });

    it('rejects an unauthenticated read of history and stats', async () => {
      expect((await testRequest(app, '/api/v1/payouts')).status).toBe(401);
      expect((await testRequest(app, '/api/v1/payouts/stats')).status).toBe(401);
    });

    it('returns 404 for a batch that does not exist once authenticated', async () => {
      const res = await testRequest(app, '/api/v1/payouts/po_does_not_exist', { headers: APPROVER });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ERR_RESOURCE_NOT_FOUND');
    });

    it('rate limits payout traffic', async () => {
      const res = await testRequest(app, '/api/v1/payouts/stats', { headers: APPROVER });

      expect(res.status).toBe(200);
      expect(res.headers.get('ratelimit-limit')).toBeTruthy();
    });
  });

  describe('validation', () => {
    beforeEach(async () => {
      await testRequest(app, '/api/v1/payouts/schedules/merch_route', {
        method: 'PUT',
        headers: APPROVER,
        body: { scheduleType: 'daily', preferredAsset: 'USDC', autoApproveLimit: 1000 },
      });
    });

    it('rejects an asset outside the payout allowlist', async () => {
      const res = await testRequest(app, '/api/v1/payouts/schedules/merch_route', {
        method: 'PUT',
        headers: APPROVER,
        body: { scheduleType: 'daily', preferredAsset: 'SCAM', autoApproveLimit: 1000 },
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ERR_VALIDATION_FAILED');
      expect(res.body.error.message).toContain('USDC');
    });

    it('rejects an unknown schedule cadence', async () => {
      const res = await testRequest(app, '/api/v1/payouts/schedules/merch_route', {
        method: 'PUT',
        headers: APPROVER,
        body: { scheduleType: 'hourly', preferredAsset: 'USDC', autoApproveLimit: 1000 },
      });

      expect(res.status).toBe(400);
    });

    it('rejects a threshold schedule with no threshold', async () => {
      const res = await testRequest(app, '/api/v1/payouts/schedules/merch_route', {
        method: 'PUT',
        headers: APPROVER,
        body: { scheduleType: 'threshold', preferredAsset: 'USDC', autoApproveLimit: 1000 },
      });

      expect(res.status).toBe(400);
    });

    it.each([
      ['negative', -1],
      ['zero', 0],
      ['NaN-ish string', 'lots'],
    ])('rejects a %s amount', async (_label, amount) => {
      const res = await testRequest(app, '/api/v1/payouts/balances/merch_route', {
        method: 'POST',
        headers: APPROVER,
        body: { amount },
      });

      expect(res.status).toBe(400);
    });

    it('rejects an amount above the route cap', async () => {
      const res = await testRequest(app, '/api/v1/payouts/balances/merch_route', {
        method: 'POST',
        headers: APPROVER,
        body: { amount: 9_999_999 },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('idempotency', () => {
    it('replays the first response for a repeated key', async () => {
      const headers = { ...APPROVER, 'idempotency-key': 'balance-key-1' };
      const first = await testRequest(app, '/api/v1/payouts/balances/merch_route', {
        method: 'POST',
        headers,
        body: { amount: 250 },
      });
      const second = await testRequest(app, '/api/v1/payouts/balances/merch_route', {
        method: 'POST',
        headers,
        body: { amount: 250 },
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
    });

    it('refuses to reuse a key for a different amount', async () => {
      const headers = { ...APPROVER, 'idempotency-key': 'balance-key-2' };
      await testRequest(app, '/api/v1/payouts/balances/merch_route', {
        method: 'POST',
        headers,
        body: { amount: 250 },
      });
      const second = await testRequest(app, '/api/v1/payouts/balances/merch_route', {
        method: 'POST',
        headers,
        body: { amount: 900 },
      });

      expect(second.status).toBe(409);
      expect(second.body.error).toBe('idempotency_key_reuse_mismatch');
    });

    it('does not apply a request that was rejected as a replay', async () => {
      const headers = { ...APPROVER, 'idempotency-key': 'balance-key-3' };
      await testRequest(app, '/api/v1/payouts/balances/merch_route', {
        method: 'POST',
        headers,
        body: { amount: 100 },
      });
      await testRequest(app, '/api/v1/payouts/balances/merch_route', {
        method: 'POST',
        headers,
        body: { amount: 700 },
      });

      expect(payoutEngine.getPendingAmount('merch_route')).toBe(100);
    });
  });

  describe('lifecycle', () => {
    beforeEach(async () => {
      await testRequest(app, '/api/v1/payouts/schedules/merch_route', {
        method: 'PUT',
        headers: APPROVER,
        body: {
          scheduleType: 'threshold',
          thresholdAmount: 100,
          preferredAsset: 'USDC',
          autoApproveLimit: 1000,
        },
      });
    });

    it('settles an auto-approved payout and exposes the transaction hash', async () => {
      await fundMerchant(app, 'merch_route', 250);
      const evaluated = await testRequest(app, '/api/v1/payouts/evaluate', {
        method: 'POST',
        headers: APPROVER,
      });

      expect(evaluated.status).toBe(200);
      expect(evaluated.body.data[0].status).toBe('completed');
      expect(evaluated.body.data[0].transactionHash).toBeTruthy();

      const detail = await testRequest(app, `/api/v1/payouts/${evaluated.body.data[0].id}`, {
        headers: APPROVER,
      });
      expect(detail.status).toBe(200);
      expect(detail.body.data.auditTrail.map((entry: { action: string }) => entry.action)).toContain('settled');
    });

    it('holds a large payout for approval and settles it on approval', async () => {
      await fundMerchant(app, 'merch_route', 1200);
      const evaluated = await testRequest(app, '/api/v1/payouts/evaluate', {
        method: 'POST',
        headers: APPROVER,
      });
      const batchId = evaluated.body.data[0].id;
      expect(evaluated.body.data[0].status).toBe('pending');

      const approved = await testRequest(app, `/api/v1/payouts/${batchId}/approve`, {
        method: 'POST',
        headers: APPROVER,
      });
      expect(approved.status).toBe(200);
      expect(approved.body.data.status).toBe('completed');
    });

    it('refuses to approve the same batch twice', async () => {
      await fundMerchant(app, 'merch_route', 1200);
      const evaluated = await testRequest(app, '/api/v1/payouts/evaluate', {
        method: 'POST',
        headers: APPROVER,
      });
      const batchId = evaluated.body.data[0].id;

      await testRequest(app, `/api/v1/payouts/${batchId}/approve`, { method: 'POST', headers: APPROVER });
      const again = await testRequest(app, `/api/v1/payouts/${batchId}/approve`, {
        method: 'POST',
        headers: APPROVER,
      });

      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('ERR_CONFIG_CONFLICT');
    });

    it('returns the reservation when an approver rejects a payout', async () => {
      await fundMerchant(app, 'merch_route', 1200);
      const evaluated = await testRequest(app, '/api/v1/payouts/evaluate', {
        method: 'POST',
        headers: APPROVER,
      });

      const rejected = await testRequest(app, `/api/v1/payouts/${evaluated.body.data[0].id}/reject`, {
        method: 'POST',
        headers: APPROVER,
      });

      expect(rejected.status).toBe(200);
      expect(rejected.body.data.status).toBe('failed');
      expect(payoutEngine.getPendingAmount('merch_route')).toBe(1200);
    });

    it('exposes stats', async () => {
      const res = await testRequest(app, '/api/v1/payouts/stats', { headers: APPROVER });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('awaitingSettlement');
      expect(res.body.data).toHaveProperty('reservedAmount');
    });

    it('scopes history by merchant', async () => {
      await fundMerchant(app, 'merch_route', 250);
      await testRequest(app, '/api/v1/payouts/evaluate', { method: 'POST', headers: APPROVER });

      const res = await testRequest(app, '/api/v1/payouts?merchantId=merch_route', { headers: APPROVER });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].merchantId).toBe('merch_route');
    });
  });
});