import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PayoutBatcher,
  startPayoutBatchWorker,
  type ProviderBatchRequest,
  type PayoutBatchProvider,
} from '../payout-batcher.js';
import { MoneyMovementAuditLog } from '../../../audit/money-movement-audit.js';
import { PayoutAnomalyDetector } from '../payout-anomaly-detector.js';

describe('PayoutBatcher — Issue #1008', () => {
  let clock: Date;
  let calls: ProviderBatchRequest[];
  let auditLog: MoneyMovementAuditLog;

  const okProvider: PayoutBatchProvider = async (request) => {
    calls.push(request);
    return { transactionHash: `tx_${calls.length}` };
  };

  function makeBatcher({ providers, ...options }: ConstructorParameters<typeof PayoutBatcher>[0] = {}) {
    return new PayoutBatcher({
      auditLog,
      now: () => clock,
      ...options,
      providers: { stellar: okProvider, ...providers },
    });
  }

  beforeEach(() => {
    clock = new Date('2026-06-01T00:00:00Z');
    calls = [];
    auditLog = new MoneyMovementAuditLog({ now: () => clock });
  });

  describe('scheduling', () => {
    it('only sends payouts whose scheduled time has arrived', async () => {
      const batcher = makeBatcher();
      const now = batcher.schedule({ merchantId: 'm1', recipient: 'r1', amount: 10, asset: 'USDC', provider: 'stellar' });
      const later = batcher.schedule({
        merchantId: 'm1',
        recipient: 'r2',
        amount: 20,
        asset: 'USDC',
        provider: 'stellar',
        scheduledFor: new Date('2026-06-02T00:00:00Z'),
      });

      const first = await batcher.runDue();
      expect(first?.summary.payoutsPaid).toBe(1);
      expect(batcher.getPayout(now.id)?.status).toBe('paid');
      expect(batcher.getPayout(later.id)?.status).toBe('scheduled');

      clock = new Date('2026-06-02T00:00:00Z');
      expect((await batcher.runDue())?.summary.payoutsPaid).toBe(1);
      expect(batcher.getPayout(later.id)?.status).toBe('paid');
    });

    it('validates input and unknown providers', () => {
      const batcher = makeBatcher();
      const base = { merchantId: 'm1', recipient: 'r1', amount: 10, asset: 'USDC' };
      expect(() => batcher.schedule({ ...base, amount: 0 })).toThrow('INVALID_PAYOUT_AMOUNT');
      expect(() => batcher.schedule({ ...base, recipient: '' })).toThrow('INVALID_PAYOUT_RECIPIENT');
      expect(() => batcher.schedule({ ...base, provider: 'nope' })).toThrow('UNKNOWN_PAYOUT_PROVIDER');
      expect(() => batcher.schedule({ ...base, scheduledFor: new Date('bad') })).toThrow('INVALID_PAYOUT_SCHEDULED_FOR');
    });

    it('cancels payouts that have not been sent', async () => {
      const batcher = makeBatcher();
      const payout = batcher.schedule({ merchantId: 'm1', recipient: 'r1', amount: 10, asset: 'USDC' });
      expect(batcher.cancel(payout.id, 'fin_1')).toBe(true);
      expect(batcher.cancel(payout.id)).toBe(false);
      expect((await batcher.runDue())?.batches).toEqual([]);
      expect(auditLog.query({ reference: payout.id, operation: 'payout.cancelled' }).records[0].actor).toBe('fin_1');
    });
  });

  describe('batching', () => {
    it('groups by provider and asset and sends each batch in one provider call', async () => {
      const other = vi.fn(async () => ({ transactionHash: 'tx_other' }));
      const batcher = makeBatcher({ providers: { other }, feePerProviderCall: 0.5 });
      for (let i = 0; i < 3; i++) {
        batcher.schedule({ merchantId: `m${i}`, recipient: `r${i}`, amount: 10, asset: 'USDC', provider: 'stellar' });
      }
      batcher.schedule({ merchantId: 'm9', recipient: 'r9', amount: 5, asset: 'XLM', provider: 'stellar' });
      batcher.schedule({ merchantId: 'm8', recipient: 'r8', amount: 7, asset: 'USDC', provider: 'other' });

      const report = await batcher.runDue();

      expect(calls).toHaveLength(2);
      expect(other).toHaveBeenCalledTimes(1);
      const usdc = calls.find((c) => c.asset === 'USDC')!;
      expect(usdc.items).toHaveLength(3);
      expect(usdc.totalAmount).toBe(30);
      expect(report?.summary).toMatchObject({ batchCount: 3, completed: 3, payoutsPaid: 5, estimatedFeesSaved: 1 });
      expect(report?.summary.amountPaidByAsset).toEqual({ USDC: 37, XLM: 5 });
    });

    it('splits large groups at the configured batch size', async () => {
      const batcher = makeBatcher({ maxBatchSize: 2 });
      for (let i = 0; i < 5; i++) {
        batcher.schedule({ merchantId: 'm1', recipient: `r${i}`, amount: 1, asset: 'USDC', provider: 'stellar' });
      }
      await batcher.runDue();
      expect(calls.map((c) => c.items.length)).toEqual([2, 2, 1]);
    });

    it('refuses overlapping runs so no payout is batched twice', async () => {
      let release!: () => void;
      const slow: PayoutBatchProvider = (request) =>
        new Promise((resolve) => {
          release = () => resolve({ transactionHash: request.batchId });
        });
      const batcher = makeBatcher({ providers: { slow } });
      batcher.schedule({ merchantId: 'm1', recipient: 'r1', amount: 1, asset: 'USDC', provider: 'slow' });

      const first = batcher.runDue();
      expect(await batcher.runDue()).toBeUndefined();
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      release();
      expect((await first)?.summary.payoutsPaid).toBe(1);
    });
  });

  describe('atomic per provider call', () => {
    it('fails every item of a batch when the provider call fails', async () => {
      const failing: PayoutBatchProvider = async () => {
        throw new Error('RAIL_DOWN');
      };
      const batcher = makeBatcher({ providers: { failing } });
      const ids = [0, 1, 2].map(
        (i) => batcher.schedule({ merchantId: 'm1', recipient: `r${i}`, amount: 5, asset: 'USDC', provider: 'failing' }).id,
      );

      const report = await batcher.runDue();

      expect(report?.batches[0]).toMatchObject({ status: 'failed', error: 'RAIL_DOWN', itemCount: 3 });
      expect(report?.batches[0].items.every((item) => item.status === 'failed')).toBe(true);
      for (const id of ids) {
        expect(batcher.getPayout(id)).toMatchObject({ status: 'scheduled', lastError: 'RAIL_DOWN', attempts: 1 });
        expect(batcher.getPayout(id)?.transactionHash).toBeUndefined();
      }
    });

    it('treats a partial acknowledgement as a failure of the whole batch', async () => {
      const partial: PayoutBatchProvider = async (request) => ({
        transactionHash: 'tx_partial',
        acceptedPayoutIds: [request.items[0].payoutId],
      });
      const batcher = makeBatcher({ providers: { partial } });
      batcher.schedule({ merchantId: 'm1', recipient: 'r1', amount: 5, asset: 'USDC', provider: 'partial' });
      batcher.schedule({ merchantId: 'm1', recipient: 'r2', amount: 5, asset: 'USDC', provider: 'partial' });

      const report = await batcher.runDue();

      expect(report?.batches[0]).toMatchObject({ status: 'failed', error: 'PARTIAL_PAYOUT_BATCH_ACKNOWLEDGEMENT' });
      expect(batcher.listPayouts({ status: 'paid' })).toEqual([]);
    });

    it('settles every item under one transaction hash on success', async () => {
      const batcher = makeBatcher();
      batcher.schedule({ merchantId: 'm1', recipient: 'r1', amount: 5, asset: 'USDC', provider: 'stellar' });
      batcher.schedule({ merchantId: 'm2', recipient: 'r2', amount: 6, asset: 'USDC', provider: 'stellar' });
      await batcher.runDue();
      const hashes = new Set(batcher.listPayouts().map((p) => p.transactionHash));
      expect([...hashes]).toEqual(['tx_1']);
    });
  });

  describe('failure isolation', () => {
    it('one failing batch does not affect the other batches of the run', async () => {
      const failing: PayoutBatchProvider = async () => {
        throw new Error('RAIL_DOWN');
      };
      const batcher = makeBatcher({ providers: { failing } });
      const bad = batcher.schedule({ merchantId: 'm1', recipient: 'r1', amount: 5, asset: 'USDC', provider: 'failing' });
      const good = batcher.schedule({ merchantId: 'm2', recipient: 'r2', amount: 6, asset: 'USDC', provider: 'stellar' });

      const report = await batcher.runDue();

      expect(report?.summary).toMatchObject({ batchCount: 2, completed: 1, failed: 1, payoutsPaid: 1, payoutsFailed: 1 });
      expect(batcher.getPayout(good.id)?.status).toBe('paid');
      expect(batcher.getPayout(bad.id)?.status).toBe('scheduled');
    });

    it('retries failed items after the delay and stops after maxAttempts', async () => {
      let healthy = false;
      const flaky: PayoutBatchProvider = async (request) => {
        if (!healthy) throw new Error('RAIL_DOWN');
        return { transactionHash: request.idempotencyKey };
      };
      const batcher = makeBatcher({ providers: { flaky }, maxAttempts: 3, retryDelayMs: 1_000 });
      const payout = batcher.schedule({ merchantId: 'm1', recipient: 'r1', amount: 5, asset: 'USDC', provider: 'flaky' });

      await batcher.runDue();
      expect((await batcher.runDue())?.batches).toEqual([]); // still backing off

      clock = new Date(clock.getTime() + 1_000);
      healthy = true;
      const retry = await batcher.runDue();
      expect(retry?.batches[0]).toMatchObject({ status: 'completed', attempt: 2 });
      expect(batcher.getPayout(payout.id)?.status).toBe('paid');

      const dead: PayoutBatchProvider = async () => {
        throw new Error('NOPE');
      };
      const exhausted = makeBatcher({ providers: { dead }, maxAttempts: 2, retryDelayMs: 0 });
      const doomed = exhausted.schedule({ merchantId: 'm1', recipient: 'r1', amount: 5, asset: 'USDC', provider: 'dead' });
      await exhausted.runDue();
      await exhausted.runDue();
      expect(exhausted.getPayout(doomed.id)).toMatchObject({ status: 'failed', attempts: 2 });
      expect((await exhausted.runDue())?.batches).toEqual([]);
    });
  });

  describe('reports', () => {
    it('shows batch status, items and history that later retries do not rewrite', async () => {
      let healthy = false;
      const flaky: PayoutBatchProvider = async (request) => {
        if (!healthy) throw new Error('RAIL_DOWN');
        return { transactionHash: request.idempotencyKey };
      };
      const batcher = makeBatcher({ providers: { flaky }, retryDelayMs: 0 });
      batcher.schedule({ merchantId: 'm1', recipient: 'r1', amount: 5, asset: 'USDC', provider: 'flaky', reference: 'inv_1' });

      const failedRun = await batcher.runDue();
      healthy = true;
      await batcher.runDue();

      const failedBatch = batcher.getBatchReport(failedRun!.batches[0].id)!;
      expect(failedBatch).toMatchObject({ status: 'failed', provider: 'flaky', asset: 'USDC', itemCount: 1 });
      expect(failedBatch.items[0]).toMatchObject({ status: 'failed', reference: 'inv_1', recipient: 'r1' });

      expect(batcher.listBatchReports({ status: 'completed' })).toHaveLength(1);
      expect(batcher.listBatchReports({ status: 'failed' })).toHaveLength(1);
      expect(batcher.getRunReport(failedRun!.runId)?.summary.failed).toBe(1);
    });

    it('writes every scheduling and settlement decision to the audit log', async () => {
      const batcher = makeBatcher();
      const payout = batcher.schedule({
        merchantId: 'm1',
        recipient: 'r1',
        amount: 5,
        asset: 'USDC',
        provider: 'stellar',
        actorId: 'fin_1',
      });
      const report = await batcher.runDue();

      expect(auditLog.query({ reference: payout.id }).records.map((r) => [r.operation, r.actor])).toEqual([
        ['payout.scheduled', 'fin_1'],
        ['payout.settled', 'system'],
      ]);
      expect(auditLog.query({ reference: report!.batches[0].id }).records[0]).toMatchObject({
        operation: 'payout_batch.settled',
        amount: 5,
      });
      expect((await auditLog.verify()).valid).toBe(true);
    });
  });

  describe('anomaly holds (#1013)', () => {
    it('holds flagged payouts out of batches until every flag is cleared', async () => {
      const detector = new PayoutAnomalyDetector({ config: { singlePayoutThreshold: 100 }, onAlert: () => {}, now: () => clock });
      const batcher = makeBatcher({ anomalyDetector: detector });
      const big = batcher.schedule({ merchantId: 'm1', recipient: 'r1', amount: 500, asset: 'USDC', provider: 'stellar' });
      const small = batcher.schedule({ merchantId: 'm2', recipient: 'r2', amount: 5, asset: 'USDC', provider: 'stellar' });

      expect(batcher.getPayout(big.id)?.status).toBe('held');
      await batcher.runDue();
      expect(calls[0].items.map((i) => i.payoutId)).toEqual([small.id]);

      const [flag] = detector.listFlags({ reference: big.id });
      detector.review(flag.id, { reviewerId: 'risk_1', decision: 'false_positive' });
      expect(batcher.getPayout(big.id)?.status).toBe('scheduled');
      await batcher.runDue();
      expect(batcher.getPayout(big.id)?.status).toBe('paid');
    });

    it('cancels a held payout when its flag is confirmed', () => {
      const detector = new PayoutAnomalyDetector({ config: { singlePayoutThreshold: 100 }, onAlert: () => {}, now: () => clock });
      const batcher = makeBatcher({ anomalyDetector: detector });
      const big = batcher.schedule({ merchantId: 'm1', recipient: 'r1', amount: 500, asset: 'USDC', provider: 'stellar' });

      const [flag] = detector.listFlags({ reference: big.id });
      detector.review(flag.id, { reviewerId: 'risk_1', decision: 'confirmed' });

      expect(batcher.getPayout(big.id)?.status).toBe('cancelled');
      expect(auditLog.query({ reference: big.id }).records.map((r) => r.operation)).toEqual([
        'payout.scheduled',
        'payout.held',
        'payout.cancelled',
      ]);
    });
  });
});

describe('startPayoutBatchWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips an interval while the previous batch pass is still running', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const runDue = vi.fn(() => new Promise<undefined>((resolve) => {
      release = () => resolve(undefined);
    }));
    const worker = startPayoutBatchWorker({ runDue }, 1_000);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(runDue).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runDue).toHaveBeenCalledTimes(2);

    worker.stop();
  });
});
