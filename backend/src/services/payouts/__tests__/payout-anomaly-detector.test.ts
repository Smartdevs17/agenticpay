import { describe, it, expect, beforeEach } from 'vitest';
import {
  PayoutAnomalyDetector,
  DEFAULT_PAYOUT_ANOMALY_CONFIG,
  MAX_ANOMALY_SUPPRESSION_MS,
  payoutAnomalyConfigFromEnv,
  type PayoutAnomalyFlag,
} from '../payout-anomaly-detector.js';

describe('PayoutAnomalyDetector — Issue #1013', () => {
  let clock: Date;
  let alerts: PayoutAnomalyFlag[];
  let detector: PayoutAnomalyDetector;
  let seq = 0;

  const observe = (merchantId: string, amount: number) =>
    detector.evaluate({ reference: `ref_${++seq}`, merchantId, amount, asset: 'USDC' });

  beforeEach(() => {
    clock = new Date('2026-05-01T12:00:00Z');
    alerts = [];
    detector = new PayoutAnomalyDetector({
      config: {
        singlePayoutThreshold: 10_000,
        velocityWindowMs: 60_000,
        velocityMaxCount: 3,
        velocityMaxAmount: 5_000,
        baselineMultiplier: 4,
        baselineMinSamples: 3,
      },
      onAlert: (flag) => alerts.push(flag),
      now: () => clock,
    });
  });

  describe('configurable thresholds', () => {
    it('does not flag ordinary payouts', () => {
      expect(observe('m1', 100)).toEqual([]);
      expect(alerts).toEqual([]);
    });

    it('flags a payout at or above the single-payout threshold', () => {
      const flags = observe('m1', 10_000);
      expect(flags.map((f) => f.rule)).toContain('single_amount');
      expect(flags.find((f) => f.rule === 'single_amount')).toMatchObject({
        severity: 'high',
        status: 'open',
        merchantId: 'm1',
        observed: { amount: 10_000, threshold: 10_000 },
      });
    });

    it('flags payout count velocity inside the window but not after it', () => {
      for (let i = 0; i < 3; i++) expect(observe('m1', 10)).toEqual([]);
      expect(observe('m1', 10).map((f) => f.rule)).toEqual(['velocity_count']);

      clock = new Date(clock.getTime() + 61_000);
      expect(observe('m1', 10)).toEqual([]);
    });

    it('flags payout amount velocity across several payouts', () => {
      expect(observe('m1', 2_000)).toEqual([]);
      expect(observe('m1', 2_000)).toEqual([]);
      expect(observe('m1', 2_000).map((f) => f.rule)).toEqual(['velocity_amount']);
    });

    it('flags deviation from the merchant baseline once enough history exists', () => {
      observe('m1', 100);
      observe('m1', 100);
      // Only 2 samples: no baseline yet.
      clock = new Date(clock.getTime() + 120_000);
      expect(observe('m1', 900).map((f) => f.rule)).toEqual([]);
      clock = new Date(clock.getTime() + 120_000);
      // Baseline is now (100+100+900)/3 ≈ 366; 4x ≈ 1466.
      expect(observe('m1', 1_500).map((f) => f.rule)).toEqual(['baseline_deviation']);
    });

    it('keeps history per merchant', () => {
      for (let i = 0; i < 3; i++) observe('m1', 10);
      expect(observe('m2', 10)).toEqual([]);
    });

    it('applies runtime config updates and rejects invalid ones atomically', () => {
      detector.updateConfig({ singlePayoutThreshold: 50 });
      expect(observe('m1', 60).map((f) => f.rule)).toContain('single_amount');

      expect(() => detector.updateConfig({ singlePayoutThreshold: 1, velocityMaxCount: -1 })).toThrow(
        'INVALID_PAYOUT_ANOMALY_CONFIG:velocityMaxCount',
      );
      expect(detector.getConfig().singlePayoutThreshold).toBe(50);
    });

    it('raises nothing while disabled', () => {
      detector.updateConfig({ enabled: false });
      expect(observe('m1', 1_000_000)).toEqual([]);
    });

    it('reads thresholds from the environment, ignoring invalid values', () => {
      const config = payoutAnomalyConfigFromEnv({
        PAYOUT_ANOMALY_SINGLE_THRESHOLD: '2500',
        PAYOUT_ANOMALY_VELOCITY_MAX_COUNT: 'abc',
        PAYOUT_ANOMALY_VELOCITY_WINDOW_MS: '-5',
        PAYOUT_ANOMALY_DETECTION_ENABLED: 'false',
      } as NodeJS.ProcessEnv);
      expect(config).toEqual({ singlePayoutThreshold: 2500, enabled: false });
      expect(new PayoutAnomalyDetector({ config }).getConfig()).toMatchObject({
        singlePayoutThreshold: 2500,
        velocityMaxCount: DEFAULT_PAYOUT_ANOMALY_CONFIG.velocityMaxCount,
      });
    });
  });

  describe('alerts', () => {
    it('emits every new flag to all subscribers', () => {
      const extra: string[] = [];
      const unsubscribe = detector.onAlert((flag) => extra.push(flag.rule));
      observe('m1', 20_000);
      expect(alerts).toHaveLength(2); // single_amount + velocity_amount
      expect(extra).toEqual(['single_amount', 'velocity_amount']);

      unsubscribe();
      observe('m3', 20_000);
      expect(extra).toHaveLength(2);
    });

    it('keeps evaluating when a subscriber throws', () => {
      detector.onAlert(() => {
        throw new Error('pager down');
      });
      expect(observe('m1', 20_000)).toHaveLength(2);
    });
  });

  describe('false-positive review path', () => {
    it('lists open flags and records a confirmed decision', () => {
      const [flag] = observe('m1', 20_000);
      expect(detector.listFlags({ status: 'open' }).map((f) => f.id)).toContain(flag.id);
      expect(detector.hasOpenFlags(flag.reference)).toBe(true);

      const reviewed = detector.review(flag.id, { reviewerId: 'risk_1', decision: 'confirmed', note: 'fraud' });
      expect(reviewed).toMatchObject({ status: 'confirmed', reviewedBy: 'risk_1', reviewNote: 'fraud' });
      expect(() => detector.review(flag.id, { reviewerId: 'risk_2', decision: 'false_positive' })).toThrow(
        'PAYOUT_ANOMALY_ALREADY_REVIEWED',
      );
    });

    it('marks a false positive and can suppress the rule for that merchant', () => {
      const [flag] = observe('m1', 20_000);
      detector.review(flag.id, { reviewerId: 'risk_1', decision: 'false_positive', suppressForMs: 3_600_000 });

      clock = new Date(clock.getTime() + 120_000);
      expect(observe('m1', 20_000).map((f) => f.rule)).toEqual(['velocity_amount']);
      // Another merchant is not covered by the suppression.
      expect(observe('m2', 20_000).map((f) => f.rule)).toContain('single_amount');

      clock = new Date(clock.getTime() + 3_600_000);
      expect(observe('m1', 20_000).map((f) => f.rule)).toContain('single_amount');
    });

    it('caps suppression and rejects invalid review input', () => {
      const [a, b] = observe('m1', 20_000);
      detector.review(a.id, { reviewerId: 'r', decision: 'false_positive', suppressForMs: 10 * MAX_ANOMALY_SUPPRESSION_MS });
      clock = new Date(clock.getTime() + MAX_ANOMALY_SUPPRESSION_MS + 1);
      expect(observe('m1', 20_000).map((f) => f.rule)).toContain('single_amount');

      expect(() => detector.review(b.id, { reviewerId: '', decision: 'confirmed' })).toThrow('REVIEWER_REQUIRED');
      expect(() => detector.review('pan_missing', { reviewerId: 'r', decision: 'confirmed' })).toThrow('NOT_FOUND');
    });

    it('notifies review subscribers', () => {
      const reviewed: string[] = [];
      detector.onReview((flag) => reviewed.push(`${flag.id}:${flag.status}`));
      const [flag] = observe('m1', 20_000);
      detector.review(flag.id, { reviewerId: 'r', decision: 'false_positive' });
      expect(reviewed).toEqual([`${flag.id}:false_positive`]);
    });
  });
});
