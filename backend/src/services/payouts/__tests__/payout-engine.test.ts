import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PAYOUT_APPROVAL_THRESHOLD,
  PayoutApprover,
  PayoutEngine,
  PayoutEvent,
  PayoutExecutionRequest,
  PayoutExecutor,
} from '../payout-engine.js';

const finance: PayoutApprover = { id: 'fin_1', role: 'finance_approver' };
const outsider = { id: 'usr_9', role: 'merchant' } as unknown as PayoutApprover;

function engineWithSchedule(options?: {
  approvalThreshold?: number;
  autoApproveLimit?: number;
  scheduleType?: 'daily' | 'weekly' | 'monthly' | 'threshold';
  executor?: PayoutExecutor;
  onEvent?: (event: PayoutEvent) => void;
  now?: () => Date;
  maxAttempts?: number;
  maxBatchAmount?: number;
}) {
  const engine = new PayoutEngine({
    approvalThreshold: options?.approvalThreshold,
    executor: options?.executor,
    onEvent: options?.onEvent,
    now: options?.now,
    maxAttempts: options?.maxAttempts,
    maxBatchAmount: options?.maxBatchAmount,
    // Deterministic retry jitter so backoff assertions are exact.
    random: () => 0.5,
  });
  engine.configureSchedule({
    id: 'sch_1',
    merchantId: 'merch_1',
    scheduleType: options?.scheduleType ?? 'threshold',
    ...(options?.scheduleType === undefined || options?.scheduleType === 'threshold'
      ? { thresholdAmount: 100 }
      : {}),
    preferredAsset: 'USDC',
    autoApproveLimit: options?.autoApproveLimit ?? 500,
  });
  return engine;
}

describe('PayoutEngine approval workflow', () => {
  afterEach(() => {
    delete process.env.PAYOUT_APPROVAL_THRESHOLD;
  });

  it('uses the default approval threshold when none is configured', () => {
    expect(new PayoutEngine().approvalThreshold).toBe(DEFAULT_PAYOUT_APPROVAL_THRESHOLD);
  });

  it('reads the approval threshold from PAYOUT_APPROVAL_THRESHOLD', () => {
    process.env.PAYOUT_APPROVAL_THRESHOLD = '2500';
    expect(new PayoutEngine().approvalThreshold).toBe(2500);
  });

  it('rejects an invalid approval threshold', () => {
    expect(() => new PayoutEngine({ approvalThreshold: 0 })).toThrow('INVALID_PAYOUT_APPROVAL_THRESHOLD');
  });

  it('holds payouts at or above the configured threshold for review', async () => {
    const engine = engineWithSchedule({ approvalThreshold: 1000, autoApproveLimit: 5000 });
    engine.setPendingAmount('merch_1', 1000);

    const [batch] = await engine.evaluatePayouts();
    expect(batch.status).toBe('pending');
  });

  it('does not create duplicate batches while a payout awaits approval', async () => {
    const engine = engineWithSchedule({ autoApproveLimit: 500 });
    engine.setPendingAmount('merch_1', 600);

    await engine.evaluatePayouts();
    const second = await engine.evaluatePayouts();

    expect(second).toHaveLength(0);
    expect(engine.getPayoutHistory()).toHaveLength(1);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid pending amount %s', (amount) => {
    const engine = engineWithSchedule();

    expect(() => engine.setPendingAmount('merch_1', amount)).toThrow('INVALID_PENDING_PAYOUT_AMOUNT');
    expect(engine.getPendingAmount('merch_1')).toBe(0);
  });

  it('returns snapshots that cannot mutate stored payout state', async () => {
    const engine = engineWithSchedule({ autoApproveLimit: 500 });
    engine.setPendingAmount('merch_1', 600);
    const [created] = await engine.evaluatePayouts();

    created.status = 'completed';
    created.amount = 1;
    created.createdAt.setUTCFullYear(1999);

    const [stored] = engine.getPayoutHistory();
    expect(stored.status).toBe('pending');
    expect(stored.amount).toBe(600);
    expect(stored.createdAt.getUTCFullYear()).not.toBe(1999);
  });

  it('rejects approval from callers without an approver role', async () => {
    const engine = engineWithSchedule({ autoApproveLimit: 500 });
    engine.setPendingAmount('merch_1', 600);
    const [batch] = await engine.evaluatePayouts();

    await expect(engine.approveManualPayout(batch.id, outsider)).rejects.toThrow('PAYOUT_APPROVER_FORBIDDEN');
    expect(engine.getBatch(batch.id)!.status).toBe('pending');
  });

  it('returns reserved funds to the merchant when a payout is rejected', async () => {
    const engine = engineWithSchedule({ autoApproveLimit: 500 });
    engine.setPendingAmount('merch_1', 600);
    const [batch] = await engine.evaluatePayouts();

    expect(await engine.rejectManualPayout(batch.id, finance)).toBe(true);
    expect(engine.getPendingAmount('merch_1')).toBe(600);
  });

  it('does not allow a rejected payout to be retried around review', async () => {
    const engine = engineWithSchedule({ autoApproveLimit: 500 });
    engine.setPendingAmount('merch_1', 600);
    const [batch] = await engine.evaluatePayouts();
    await engine.rejectManualPayout(batch.id, finance);

    expect(await engine.retryFailedBatch(batch.id, finance)).toBe(false);
    expect(engine.getBatch(batch.id)!.status).toBe('failed');
  });

  it('records an audit entry for every approval decision', async () => {
    const engine = engineWithSchedule({ autoApproveLimit: 500 });
    engine.setPendingAmount('merch_1', 600);
    const [batch] = await engine.evaluatePayouts();

    await engine.approveManualPayout(batch.id, finance);

    const trail = engine.getAuditTrail(batch.id);
    expect(trail.map((entry) => entry.action)).toEqual([
      'created',
      'approved',
      'executing',
      'settled',
    ]);
    expect(trail[1].actorId).toBe('fin_1');

    trail[0].actorId = 'tampered';
    trail[0].timestamp.setUTCFullYear(1999);
    const stored = engine.getAuditTrail(batch.id)[0];
    expect(stored.actorId).toBe('system');
    expect(stored.timestamp.getUTCFullYear()).not.toBe(1999);
  });
});

describe('PayoutEngine execution', () => {
  it('settles an auto-approved batch through the rail and records the transaction', async () => {
    const executor = vi.fn(async () => ({ transactionHash: 'tx_abc' }));
    const engine = engineWithSchedule({ autoApproveLimit: 500, executor });

    engine.setPendingAmount('merch_1', 150);
    const [batch] = await engine.evaluatePayouts();

    expect(batch.status).toBe('completed');
    expect(batch.transactionHash).toBe('tx_abc');
    expect(batch.settledAt).toBeInstanceOf(Date);
    expect(batch.attempts).toBe(1);
    expect(engine.getPendingAmount('merch_1')).toBe(0);
    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'merch_1', asset: 'USDC', amount: 150, attempt: 1 }),
    );
  });

  it('hands the rail a stable idempotency key across attempts', async () => {
    const seen: PayoutExecutionRequest[] = [];
    const executor: PayoutExecutor = async (request) => {
      seen.push(request);
      throw new Error('rail unavailable');
    };
    const engine = engineWithSchedule({ autoApproveLimit: 500, executor, maxAttempts: 3 });
    engine.setPendingAmount('merch_1', 150);

    const [batch] = await engine.evaluatePayouts();
    await engine.retryFailedBatch(batch.id, finance);
    await engine.approveManualPayout(batch.id, finance);

    expect(seen).toHaveLength(2);
    expect(seen[0].idempotencyKey).toBe(batch.idempotencyKey);
    expect(seen[1].idempotencyKey).toBe(batch.idempotencyKey);
    expect(seen.map((request) => request.attempt)).toEqual([1, 2]);
  });

  it('never marks a batch completed when the rail returns no transaction hash', async () => {
    const engine = engineWithSchedule({
      autoApproveLimit: 500,
      executor: async () => ({ transactionHash: '' }),
      maxAttempts: 1,
    });
    engine.setPendingAmount('merch_1', 150);

    const [batch] = await engine.evaluatePayouts();

    expect(batch.status).toBe('failed');
    expect(batch.transactionHash).toBeUndefined();
  });

  it('emits payout lifecycle events', async () => {
    const events: string[] = [];
    const engine = engineWithSchedule({
      autoApproveLimit: 500,
      onEvent: (event) => events.push(event.type),
    });
    engine.setPendingAmount('merch_1', 150);

    await engine.evaluatePayouts();

    expect(events).toEqual(['payout.created', 'payout.executing', 'payout.completed']);
  });

  it('keeps settling when a subscriber throws', async () => {
    const engine = engineWithSchedule({
      autoApproveLimit: 500,
      onEvent: () => {
        throw new Error('webhook endpoint down');
      },
    });
    engine.setPendingAmount('merch_1', 150);

    const [batch] = await engine.evaluatePayouts();

    expect(batch.status).toBe('completed');
  });
});

describe('PayoutEngine retry policy', () => {
  it('fails a batch and schedules a backed-off retry when the rail rejects', async () => {
    let clock = new Date('2026-01-01T00:00:00.000Z');
    const engine = engineWithSchedule({
      autoApproveLimit: 500,
      executor: async () => {
        throw new Error('rail timeout');
      },
      now: () => clock,
      maxAttempts: 3,
    });
    engine.setPendingAmount('merch_1', 150);

    const [batch] = await engine.evaluatePayouts();

    expect(batch.status).toBe('failed');
    expect(batch.attempts).toBe(1);
    expect(batch.errorCode).toBe('PAYOUT_EXECUTION_FAILED');
    // deterministic jitter: 30s base * 2^0 * (1 + 0) = 30s
    expect(batch.nextAttemptAt?.getTime() - clock.getTime()).toBe(30_000);
  });

  it('doubles the backoff on each attempt', async () => {
    let clock = new Date('2026-01-01T00:00:00.000Z');
    const engine = engineWithSchedule({
      autoApproveLimit: 500,
      executor: async () => {
        throw new Error('rail timeout');
      },
      now: () => clock,
      maxAttempts: 4,
    });
    engine.setPendingAmount('merch_1', 150);
    const [created] = await engine.evaluatePayouts();

    await engine.retryFailedBatch(created.id, finance);
    await engine.approveManualPayout(created.id, finance);

    const afterSecond = engine.getBatch(created.id)!;
    expect(afterSecond.attempts).toBe(2);
    expect(afterSecond.nextAttemptAt!.getTime() - clock.getTime()).toBe(60_000);

    clock = new Date(afterSecond.nextAttemptAt!.getTime());
    await engine.retryDueBatches();

    const afterThird = engine.getBatch(created.id)!;
    expect(afterThird.attempts).toBe(3);
    expect(afterThird.nextAttemptAt!.getTime() - clock.getTime()).toBe(120_000);
  });

  it('does not retry a batch whose backoff has not elapsed', async () => {
    const engine = engineWithSchedule({
      autoApproveLimit: 500,
      executor: async () => {
        throw new Error('rail timeout');
      },
      maxAttempts: 3,
    });
    engine.setPendingAmount('merch_1', 150);
    await engine.evaluatePayouts();

    expect(await engine.retryDueBatches()).toHaveLength(0);
  });

  it('retries a batch once its backoff has elapsed and succeeds', async () => {
    let attempt = 0;
    let clock = new Date('2026-01-01T00:00:00.000Z');
    const engine = engineWithSchedule({
      autoApproveLimit: 500,
      executor: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('rail timeout');
        return { transactionHash: 'tx_retry' };
      },
      now: () => clock,
      maxAttempts: 3,
    });
    engine.setPendingAmount('merch_1', 150);
    const [created] = await engine.evaluatePayouts();
    expect(created.status).toBe('failed');

    clock = new Date(clock.getTime() + 30_000);
    const retried = await engine.retryDueBatches();

    expect(retried).toHaveLength(1);
    expect(retried[0].status).toBe('completed');
    expect(retried[0].transactionHash).toBe('tx_retry');
    expect(engine.getBatch(created.id)!.attempts).toBe(2);
  });

  it('stops after maxAttempts and keeps the reservation for an operator', async () => {
    let clock = new Date('2026-01-01T00:00:00.000Z');
    const engine = engineWithSchedule({
      autoApproveLimit: 500,
      executor: async () => {
        throw new Error('rail down');
      },
      now: () => clock,
      maxAttempts: 1,
    });
    engine.setPendingAmount('merch_1', 150);
    const [batch] = await engine.evaluatePayouts();

    expect(batch.status).toBe('failed');
    expect(batch.errorCode).toBe('PAYOUT_ATTEMPTS_EXHAUSTED');
    expect(batch.nextAttemptAt).toBeUndefined();
    expect(engine.getPendingAmount('merch_1')).toBe(0);
    expect(engine.getStats().reservedAmount).toBe(150);

    // No automatic re-payout loop: an operator releases the reservation explicitly.
    clock = new Date(clock.getTime() + 86_400_000);
    expect(await engine.evaluatePayouts()).toHaveLength(0);
  });

  it('releases an exhausted reservation when an approver asks for it', async () => {
    const engine = engineWithSchedule({
      autoApproveLimit: 500,
      executor: async () => {
        throw new Error('rail down');
      },
      maxAttempts: 1,
    });
    engine.setPendingAmount('merch_1', 150);
    const [batch] = await engine.evaluatePayouts();

    expect(await engine.releaseReservedFunds(batch.id, finance)).toBe(true);
    expect(engine.getPendingAmount('merch_1')).toBe(150);
    expect(engine.getStats().reservedAmount).toBe(0);
    // Released once only.
    expect(await engine.releaseReservedFunds(batch.id, finance)).toBe(false);
  });

  it('does not let the retry worker push an unreviewed batch past approval', async () => {
    let clock = new Date('2026-01-01T00:00:00.000Z');
    const engine = engineWithSchedule({
      autoApproveLimit: 500,
      scheduleType: 'threshold',
      executor: async () => {
        throw new Error('rail timeout');
      },
      now: () => clock,
      maxAttempts: 5,
    });
    engine.setPendingAmount('merch_1', 600);

    const [created] = await engine.evaluatePayouts();
    await engine.approveManualPayout(created.id, finance);
    expect(engine.getBatch(created.id)!.status).toBe('failed');

    clock = new Date(clock.getTime() + 60_000);
    const [requeued] = await engine.retryDueBatches();

    expect(requeued.status).toBe('pending');
    expect(requeued.attempts).toBe(1);
  });
});

describe('PayoutEngine schedule cadence', () => {
  it('waits out the period before paying a daily schedule again', async () => {
    let clock = new Date('2026-01-01T00:00:00.000Z');
    const engine = engineWithSchedule({ autoApproveLimit: 500, scheduleType: 'daily', now: () => clock });
    engine.setPendingAmount('merch_1', 150);

    expect(await engine.evaluatePayouts()).toHaveLength(1);

    engine.setPendingAmount('merch_1', 150);
    clock = new Date(clock.getTime() + 60_000);
    expect(await engine.evaluatePayouts()).toHaveLength(0);

    clock = new Date(clock.getTime() + 24 * 60 * 60 * 1000);
    expect(await engine.evaluatePayouts()).toHaveLength(1);
  });

  it('does not pay the same calendar period twice even if the schedule is re-armed', async () => {
    let clock = new Date('2026-01-01T00:00:00.000Z');
    const engine = engineWithSchedule({ autoApproveLimit: 500, scheduleType: 'weekly', now: () => clock });
    engine.setPendingAmount('merch_1', 150);
    await engine.evaluatePayouts();

    // Re-arming the schedule must not clear the period's cycle marker.
    engine.configureSchedule({
      id: 'sch_1',
      merchantId: 'merch_1',
      scheduleType: 'weekly',
      preferredAsset: 'USDC',
      autoApproveLimit: 500,
    });
    engine.setPendingAmount('merch_1', 150);
    clock = new Date(clock.getTime() + 60_000);

    expect(await engine.evaluatePayouts()).toHaveLength(0);
  });

  it('pays a new threshold cycle as soon as fresh funds arrive', async () => {
    const engine = engineWithSchedule({ autoApproveLimit: 500 });
    engine.setPendingAmount('merch_1', 150);
    expect(await engine.evaluatePayouts()).toHaveLength(1);

    engine.setPendingAmount('merch_1', 250);
    expect(await engine.evaluatePayouts()).toHaveLength(1);
    expect(engine.getPayoutHistory()).toHaveLength(2);
  });

  it('rejects a threshold schedule with a zero or missing threshold', () => {
    for (const thresholdAmount of [0, -1, Number.NaN, undefined]) {
      const engine = new PayoutEngine();
      expect(() =>
        engine.configureSchedule({
          id: 'sch_x',
          merchantId: 'merch_x',
          scheduleType: 'threshold',
          thresholdAmount,
          preferredAsset: 'USDC',
          autoApproveLimit: 500,
        }),
      ).toThrow('INVALID_PAYOUT_THRESHOLD_AMOUNT');
    }
  });

  it('rejects a schedule that names an asset the platform does not pay out', () => {
    const engine = new PayoutEngine();
    expect(() =>
      engine.configureSchedule({
        id: 'sch_x',
        merchantId: 'merch_x',
        scheduleType: 'daily',
        preferredAsset: 'SCAM',
        autoApproveLimit: 500,
      }),
    ).toThrow('UNSUPPORTED_PAYOUT_ASSET');
  });

  it('isolates one merchant misconfiguration from the rest of the pass', async () => {
    const engine = engineWithSchedule({ autoApproveLimit: 500, maxBatchAmount: 200 });
    engine.setPendingAmount('merch_1', 150);
    engine.configureSchedule({
      id: 'sch_2',
      merchantId: 'merch_2',
      scheduleType: 'daily',
      preferredAsset: 'USDC',
      autoApproveLimit: 500,
    });
    engine.setPendingAmount('merch_2', 999_999);

    const batches = await engine.evaluatePayouts();

    expect(batches).toHaveLength(1);
    expect(batches[0].merchantId).toBe('merch_1');
    expect(engine.getAuditTrail('sch_2').map((entry) => entry.action)).toEqual(['failed']);
  });
});

describe('PayoutEngine safety limits', () => {
  it('refuses to create a batch above the engine-level cap', async () => {
    const engine = engineWithSchedule({ autoApproveLimit: 500, maxBatchAmount: 100 });
    engine.setPendingAmount('merch_1', 150);

    expect(await engine.evaluatePayouts()).toHaveLength(0);
    expect(engine.getPayoutHistory()).toHaveLength(0);
  });

  it('collapses concurrent evaluation passes into one batch', async () => {
    const engine = engineWithSchedule({ autoApproveLimit: 500 });
    engine.setPendingAmount('merch_1', 150);

    const [first, second] = await Promise.all([engine.evaluatePayouts(), engine.evaluatePayouts()]);

    expect(first.length + second.length).toBe(1);
    expect(engine.getPayoutHistory()).toHaveLength(1);
  });

  it('scopes history to a single merchant', async () => {
    const engine = engineWithSchedule({ autoApproveLimit: 500 });
    engine.configureSchedule({
      id: 'sch_2',
      merchantId: 'merch_2',
      scheduleType: 'daily',
      preferredAsset: 'USDC',
      autoApproveLimit: 500,
    });
    engine.setPendingAmount('merch_1', 150);
    engine.setPendingAmount('merch_2', 150);
    await engine.evaluatePayouts();

    expect(engine.getPayoutHistory('merch_1')).toHaveLength(1);
    expect(engine.getPayoutHistory('merch_2')[0].merchantId).toBe('merch_2');
    expect(engine.getPayoutHistory()).toHaveLength(2);
  });

  it('reports counts and money owed', async () => {
    const engine = engineWithSchedule({ autoApproveLimit: 500 });
    engine.setPendingAmount('merch_1', 150);
    await engine.evaluatePayouts();
    engine.setPendingAmount('merch_1', 70);

    expect(engine.getStats()).toMatchObject({
      completed: 1,
      total: 1,
      awaitingSettlement: 70,
      reservedAmount: 0,
    });
  });
});