/**
 * Route coverage for payout batching (#1008), anomaly review (#1013) and the
 * money-movement audit endpoints (#1011).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { payoutsRouter } from '../payouts.js';
import { payoutEngine } from '../../services/payouts/payout-engine.js';
import { payoutBatcher } from '../../services/payouts/payout-batcher.js';
import { payoutAnomalyDetector, DEFAULT_PAYOUT_ANOMALY_CONFIG } from '../../services/payouts/payout-anomaly-detector.js';
import { clearIdempotencyCache } from '../../middleware/idempotency.js';

const APPROVER = { 'x-actor-id': 'fin_1', 'x-actor-role': 'finance_approver' };
const ADMIN = { 'x-actor-id': 'adm_1', 'x-actor-role': 'admin' };

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/payouts', payoutsRouter);
  // Duck-typed so the assertion does not depend on which AppError module instance threw.
  app.use((err: { statusCode?: number; code?: string; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode ?? 500).json({ error: { code: err.code, message: err.message } });
  });
  return app;
}

async function call(
  app: Express,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/payouts${path}`, {
      method: options.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : undefined) as any };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

let keySeq = 0;
const idem = (headers: Record<string, string>) => ({ ...headers, 'Idempotency-Key': `k-${++keySeq}-${Date.now()}` });

describe('Payout batching, anomaly and audit routes', () => {
  let app: Express;

  beforeEach(() => {
    clearIdempotencyCache();
    payoutEngine.reset();
    payoutBatcher.reset();
    payoutAnomalyDetector.reset();
    payoutAnomalyDetector.updateConfig({ ...DEFAULT_PAYOUT_ANOMALY_CONFIG });
    app = createTestApp();
  });

  describe('scheduled payouts (#1008)', () => {
    it('requires an approver for every scheduling route', async () => {
      for (const [method, path] of [
        ['POST', '/scheduled'],
        ['GET', '/scheduled'],
        ['POST', '/scheduled/run'],
        ['GET', '/batches'],
        ['GET', '/anomalies'],
        ['GET', '/audit'],
      ]) {
        const res = await call(app, path, { method, body: method === 'POST' ? {} : undefined });
        expect(res.status, `${method} ${path}`).toBe(401);
      }
    });

    it('schedules, batches and reports payouts', async () => {
      for (const recipient of ['GA_1', 'GA_2']) {
        const created = await call(app, '/scheduled', {
          method: 'POST',
          headers: idem(APPROVER),
          body: { merchantId: 'merch_b', recipient, amount: 25, asset: 'USDC', reference: `inv-${recipient}` },
        });
        expect(created.status).toBe(201);
        expect(created.body.data.status).toBe('scheduled');
      }

      const run = await call(app, '/scheduled/run', { method: 'POST', headers: idem(APPROVER) });
      expect(run.status).toBe(200);
      expect(run.body.data.summary).toMatchObject({ batchCount: 1, completed: 1, payoutsPaid: 2 });

      const batchId = run.body.data.batches[0].id;
      const report = await call(app, `/batches/${batchId}`, { headers: APPROVER });
      expect(report.body.data).toMatchObject({ status: 'completed', itemCount: 2, totalAmount: 50, asset: 'USDC' });

      const runReport = await call(app, `/batches/runs/${run.body.data.runId}`, { headers: APPROVER });
      expect(runReport.body.data.summary.payoutsPaid).toBe(2);

      const listed = await call(app, '/batches?status=completed', { headers: APPROVER });
      expect(listed.body.count).toBe(1);

      const paid = await call(app, '/scheduled?status=paid', { headers: APPROVER });
      expect(paid.body.count).toBe(2);
    });

    it('validates scheduled payout input', async () => {
      const bad = [
        { merchantId: 'm', recipient: 'r', amount: -1, asset: 'USDC' },
        { merchantId: 'm', recipient: 'r', amount: 10, asset: 'DOGE' },
        { merchantId: 'm', recipient: 'r', amount: 10, asset: 'USDC', scheduledFor: 'tomorrow-ish' },
        { merchantId: 'm', recipient: 'r', amount: 10, asset: 'USDC', provider: 'unknown' },
        { recipient: 'r', amount: 10, asset: 'USDC' },
      ];
      for (const body of bad) {
        const res = await call(app, '/scheduled', { method: 'POST', headers: idem(APPROVER), body });
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
    });

    it('cancels a scheduled payout once', async () => {
      const created = await call(app, '/scheduled', {
        method: 'POST',
        headers: idem(APPROVER),
        body: { merchantId: 'merch_c', recipient: 'GA_9', amount: 5, asset: 'USDC', scheduledFor: '2099-01-01T00:00:00Z' },
      });
      const id = created.body.data.id;
      expect((await call(app, `/scheduled/${id}`, { method: 'DELETE', headers: APPROVER })).body.data.status).toBe(
        'cancelled',
      );
      expect((await call(app, `/scheduled/${id}`, { method: 'DELETE', headers: APPROVER })).status).toBe(409);
    });

    it('returns 404 for unknown batches and runs', async () => {
      expect((await call(app, '/batches/pbat_missing', { headers: APPROVER })).status).toBe(404);
      expect((await call(app, '/batches/runs/prun_missing', { headers: APPROVER })).status).toBe(404);
    });
  });

  describe('anomaly review (#1013)', () => {
    async function scheduleLarge() {
      return call(app, '/scheduled', {
        method: 'POST',
        headers: idem(APPROVER),
        body: { merchantId: 'merch_big', recipient: 'GA_X', amount: 75_000, asset: 'USDC' },
      });
    }

    it('holds a large payout and releases it after a false-positive review', async () => {
      const created = await scheduleLarge();
      expect(created.body.data.status).toBe('held');

      const open = await call(app, '/anomalies?status=open', { headers: APPROVER });
      const flag = open.body.data.find((f: any) => f.rule === 'single_amount');
      expect(flag).toMatchObject({ merchantId: 'merch_big', severity: 'high' });

      // Releasing needs every flag on the payout cleared.
      for (const f of open.body.data) {
        const reviewed = await call(app, `/anomalies/${f.id}/review`, {
          method: 'POST',
          headers: idem(APPROVER),
          body: { decision: 'false_positive', note: 'known payroll run' },
        });
        expect(reviewed.status).toBe(200);
        expect(reviewed.body.data).toMatchObject({ status: 'false_positive', reviewedBy: 'fin_1' });
      }

      const payouts = await call(app, '/scheduled?merchantId=merch_big', { headers: APPROVER });
      expect(payouts.body.data[0].status).toBe('scheduled');

      const again = await call(app, `/anomalies/${flag.id}/review`, {
        method: 'POST',
        headers: idem(APPROVER),
        body: { decision: 'confirmed' },
      });
      expect(again.status).toBe(409);
    });

    it('validates review input', async () => {
      await scheduleLarge();
      const [flag] = (await call(app, '/anomalies', { headers: APPROVER })).body.data;
      const bad = [{ decision: 'maybe' }, { decision: 'confirmed', suppressForMs: 1000 }, { decision: 'false_positive', note: 5 }];
      for (const body of bad) {
        const res = await call(app, `/anomalies/${flag.id}/review`, { method: 'POST', headers: idem(APPROVER), body });
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      const missing = await call(app, '/anomalies/pan_missing/review', {
        method: 'POST',
        headers: idem(APPROVER),
        body: { decision: 'confirmed' },
      });
      expect(missing.status).toBe(404);
    });

    it('lets only admins change thresholds', async () => {
      const denied = await call(app, '/anomalies/config', {
        method: 'PUT',
        headers: APPROVER,
        body: { singlePayoutThreshold: 1 },
      });
      expect(denied.status).toBe(403);

      const updated = await call(app, '/anomalies/config', {
        method: 'PUT',
        headers: ADMIN,
        body: { singlePayoutThreshold: 1_000, velocityMaxCount: 5 },
      });
      expect(updated.status).toBe(200);
      expect(updated.body.data).toMatchObject({ singlePayoutThreshold: 1_000, velocityMaxCount: 5 });
      expect((await call(app, '/anomalies/config', { headers: APPROVER })).body.data.singlePayoutThreshold).toBe(1_000);

      for (const body of [{ singlePayoutThreshold: -5 }, { bogus: 1 }]) {
        expect((await call(app, '/anomalies/config', { method: 'PUT', headers: ADMIN, body })).status).toBe(400);
      }
    });
  });

  describe('money-movement audit (#1011)', () => {
    it('records engine and batcher movements and answers compliance queries', async () => {
      await call(app, '/balances/merch_audit', { method: 'POST', headers: idem(APPROVER), body: { amount: 120 } });
      const scheduled = await call(app, '/scheduled', {
        method: 'POST',
        headers: idem(APPROVER),
        body: { merchantId: 'merch_audit', recipient: 'GA_A', amount: 30, asset: 'USDC' },
      });
      await call(app, '/scheduled/run', { method: 'POST', headers: idem(APPROVER) });

      const byMerchant = await call(app, '/audit?merchantId=merch_audit', { headers: APPROVER });
      const ops = byMerchant.body.data.map((r: any) => r.operation);
      expect(ops).toEqual(expect.arrayContaining(['balance.set', 'payout.scheduled', 'payout.settled']));
      expect(byMerchant.body.data.find((r: any) => r.operation === 'balance.set')).toMatchObject({
        actor: 'fin_1',
        amount: 120,
      });

      const byReference = await call(app, `/audit?reference=${scheduled.body.data.id}&operation=payout.settled`, {
        headers: APPROVER,
      });
      expect(byReference.body.total).toBe(1);
      expect(byReference.body.totalAmountByAsset).toEqual({ USDC: 30 });

      const verified = await call(app, '/audit/verify', { headers: APPROVER });
      expect(verified.body.data.valid).toBe(true);
    });

    it('rejects malformed audit filters', async () => {
      for (const query of ['minAmount=-1', 'limit=abc', 'from=not-a-date']) {
        expect((await call(app, `/audit?${query}`, { headers: APPROVER })).status, query).toBe(400);
      }
    });
  });
});
