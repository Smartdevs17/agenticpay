import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PAYOUT_APPROVAL_THRESHOLD, PayoutApprover, PayoutEngine } from '../payout-engine.js';

const finance: PayoutApprover = { id: 'fin_1', role: 'finance_approver' };
const outsider = { id: 'usr_9', role: 'merchant' } as unknown as PayoutApprover;

function engineWithSchedule(options?: { approvalThreshold?: number; autoApproveLimit?: number }) {
  const engine = new PayoutEngine({ approvalThreshold: options?.approvalThreshold });
  engine.configureSchedule({
    id: 'sch_1',
    merchantId: 'merch_1',
    scheduleType: 'threshold',
    thresholdAmount: 100,
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
    expect(batch.status).toBe('pending');
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
    expect(batch.status).toBe('failed');
  });

  it('records an audit entry for every approval decision', async () => {
    const engine = engineWithSchedule({ autoApproveLimit: 500 });
    engine.setPendingAmount('merch_1', 600);
    const [batch] = await engine.evaluatePayouts();

    await engine.approveManualPayout(batch.id, finance);

    const trail = engine.getAuditTrail(batch.id);
    expect(trail.map((entry) => entry.action)).toEqual(['created', 'approved']);
    expect(trail[1].actorId).toBe('fin_1');

    trail[0].actorId = 'tampered';
    trail[0].timestamp.setUTCFullYear(1999);
    const stored = engine.getAuditTrail(batch.id)[0];
    expect(stored.actorId).toBe('system');
    expect(stored.timestamp.getUTCFullYear()).not.toBe(1999);
  });
});
