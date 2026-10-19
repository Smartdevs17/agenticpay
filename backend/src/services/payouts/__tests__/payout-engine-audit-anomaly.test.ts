import { describe, it, expect, beforeEach } from 'vitest';
import { PayoutEngine, type PayoutApprover, type PayoutExecutor } from '../payout-engine.js';
import { MoneyMovementAuditLog } from '../../../audit/money-movement-audit.js';
import { PayoutAnomalyDetector } from '../payout-anomaly-detector.js';

const finance: PayoutApprover = { id: 'fin_1', role: 'finance_approver' };

describe('PayoutEngine money-movement audit (#1011) and anomaly holds (#1013)', () => {
  let clock: Date;
  let auditLog: MoneyMovementAuditLog;
  let detector: PayoutAnomalyDetector;

  function makeEngine(executor?: PayoutExecutor, autoApproveLimit = 500) {
    const engine = new PayoutEngine({
      auditLog,
      anomalyDetector: detector,
      executor,
      maxAttempts: 1,
      now: () => clock,
      random: () => 0.5,
    });
    engine.configureSchedule({
      id: 'sch_1',
      merchantId: 'merch_1',
      scheduleType: 'threshold',
      thresholdAmount: 100,
      preferredAsset: 'USDC',
      autoApproveLimit,
    });
    return engine;
  }

  beforeEach(() => {
    clock = new Date('2026-07-01T00:00:00Z');
    auditLog = new MoneyMovementAuditLog({ now: () => clock });
    detector = new PayoutAnomalyDetector({
      config: { singlePayoutThreshold: 5_000 },
      onAlert: () => {},
      now: () => clock,
    });
  });

  it('audits balance, reservation and settlement of an auto-approved payout', async () => {
    const engine = makeEngine();
    engine.setPendingAmount('merch_1', 200, 'fin_1');
    const [batch] = await engine.evaluatePayouts();

    expect(auditLog.query().records.map((r) => [r.operation, r.actor, r.amount, r.reference])).toEqual([
      ['balance.set', 'fin_1', 200, 'balance:merch_1'],
      ['payout.reserved', 'system', 200, batch.id],
      ['payout.settled', 'system', 200, batch.id],
    ]);
    expect(auditLog.query({ operation: 'payout.settled' }).records[0].metadata).toMatchObject({
      transactionHash: batch.transactionHash,
    });
    expect((await auditLog.verify()).valid).toBe(true);
  });

  it('audits manual approval, rejection and fund release with the approver as actor', async () => {
    const engine = makeEngine(undefined, 50);
    engine.setPendingAmount('merch_1', 300);
    const [first] = await engine.evaluatePayouts();
    await engine.approveManualPayout(first.id, finance);

    engine.setPendingAmount('merch_1', 400);
    const [second] = await engine.evaluatePayouts();
    await engine.rejectManualPayout(second.id, { id: 'fin_2', role: 'admin' });

    expect(auditLog.query({ reference: first.id }).records.map((r) => [r.operation, r.actor])).toEqual([
      ['payout.reserved', 'system'],
      ['payout.approved', 'fin_1'],
      ['payout.settled', 'fin_1'],
    ]);
    expect(auditLog.query({ reference: second.id }).records.map((r) => [r.operation, r.actor])).toEqual([
      ['payout.reserved', 'system'],
      ['payout.rejected', 'fin_2'],
      ['payout.released', 'fin_2'],
    ]);
  });

  it('audits failed settlement and a single release of the reservation', async () => {
    const engine = makeEngine(async () => {
      throw new Error('RAIL_DOWN');
    });
    engine.setPendingAmount('merch_1', 200);
    const [batch] = await engine.evaluatePayouts();
    await engine.releaseReservedFunds(batch.id, finance);

    const ops = auditLog.query({ reference: batch.id }).records.map((r) => r.operation);
    expect(ops).toEqual(['payout.reserved', 'payout.failed', 'payout.released']);
    expect(auditLog.query({ operation: 'payout.failed' }).records[0].metadata).toMatchObject({
      error: 'RAIL_DOWN',
      final: true,
    });
  });

  it('forces review of a flagged batch even under the auto-approve limit', async () => {
    const engine = makeEngine(undefined, 1_000_000);
    engine.setPendingAmount('merch_1', 6_000);
    const [batch] = await engine.evaluatePayouts();

    expect(batch.requiresApproval).toBe(true);
    expect(batch.status).toBe('pending');
    expect(engine.getAuditTrail(batch.id).some((e) => e.details?.includes('anomaly review'))).toBe(true);
    expect(auditLog.query({ reference: batch.id }).records[0].metadata).toMatchObject({
      anomalyFlags: ['single_amount'],
    });
  });

  it('blocks approval until the anomaly flag is reviewed', async () => {
    const engine = makeEngine(undefined, 1_000_000);
    engine.setPendingAmount('merch_1', 6_000);
    const [batch] = await engine.evaluatePayouts();

    await expect(engine.approveManualPayout(batch.id, finance)).rejects.toThrow('PAYOUT_ANOMALY_REVIEW_PENDING');

    const [flag] = detector.listFlags({ reference: batch.id });
    detector.review(flag.id, { reviewerId: 'risk_1', decision: 'false_positive' });

    expect(await engine.approveManualPayout(batch.id, finance)).toBe(true);
    expect(engine.getBatch(batch.id)?.status).toBe('completed');
  });

  it('leaves engines without a detector or audit log unchanged', async () => {
    const engine = new PayoutEngine({ now: () => clock });
    engine.configureSchedule({
      id: 'sch_1',
      merchantId: 'merch_1',
      scheduleType: 'threshold',
      thresholdAmount: 100,
      preferredAsset: 'USDC',
      autoApproveLimit: 1_000_000,
    });
    engine.setPendingAmount('merch_1', 6_000);
    const [batch] = await engine.evaluatePayouts();
    expect(batch.status).toBe('completed');
    expect(auditLog.size).toBe(0);
  });
});
