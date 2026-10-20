import { describe, expect, it, beforeEach } from 'vitest';
import {
  scoreTransaction,
  trainModel,
  updateThresholds,
  getThresholds,
  getReviewQueue,
  getModelState,
  runAdversarialRobustnessProbe,
  engineerFeatures,
  TransactionSample,
  LabeledSample,
} from '../fraud-detection.js';

const lowRiskSample: TransactionSample = {
  transactionId: 'tx-low',
  accountAgeDays: 900,
  amountUsd: 25,
  velocity1h: 1,
  geoDistanceKm: 5,
  deviceRisk: 0.05,
  failedAttempts24h: 0,
  chargebacks90d: 0,
};

const highRiskSample: TransactionSample = {
  transactionId: 'tx-high',
  accountAgeDays: 0,
  amountUsd: 100_000,
  velocity1h: 100,
  geoDistanceKm: 20_000,
  deviceRisk: 1,
  failedAttempts24h: 20,
  chargebacks90d: 10,
};

describe('fraud-detection engine', () => {
  beforeEach(() => {
    // Restore the default thresholds, which also resets if left inconsistent.
    updateThresholds({ review: 0.45, block: 0.8 });
  });

  it('engineers normalized features within [0, 1]', () => {
    const features = engineerFeatures(highRiskSample);
    for (const value of Object.values(features)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(Object.keys(features)).toContain('accountAgeDays');
  });

  it('returns a bounded probability risk score', () => {
    const result = scoreTransaction(lowRiskSample);
    expect(result.transactionId).toBe('tx-low');
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(1);
  });

  it('allows a clearly low-risk transaction', () => {
    const result = scoreTransaction(lowRiskSample);
    expect(result.action).toBe('allow');
  });

  it('flags a clearly high-risk transaction for review or block', () => {
    const result = scoreTransaction(highRiskSample);
    expect(['review', 'block']).toContain(result.action);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('queues transactions that require review', () => {
    const before = getReviewQueue().length;
    // Force every scored transaction into the review band.
    updateThresholds({ review: 0, block: 1 });
    scoreTransaction({ ...lowRiskSample, transactionId: 'tx-queued' });
    const queue = getReviewQueue();
    expect(queue.length).toBe(before + 1);
    expect(queue[0].transactionId).toBe('tx-queued');
  });

  it('updates and returns thresholds', () => {
    const updated = updateThresholds({ review: 0.3, block: 0.7 });
    expect(updated).toEqual({ review: 0.3, block: 0.7 });
    expect(getThresholds()).toEqual({ review: 0.3, block: 0.7 });
  });

  it('resets thresholds when they become inconsistent', () => {
    updateThresholds({ review: 0.9, block: 0.5 });
    expect(getThresholds()).toEqual({ review: 0.45, block: 0.8 });
  });

  it('trains the model and grows the trained sample count', () => {
    const before = getModelState();
    const samples: LabeledSample[] = [
      { ...lowRiskSample, transactionId: 's1', label: 0 },
      { ...highRiskSample, transactionId: 's2', label: 1 },
    ];
    const trained = trainModel(samples, 0.3, 50);
    expect(trained.trainedSamples).toBe(before.trainedSamples + 2);
    expect(trained.version).not.toBe(before.version);
    expect(trained.weights).toHaveLength(7);
  });

  it('leaves the model unchanged when trained with no samples', () => {
    const before = getModelState();
    const after = trainModel([]);
    expect(after.version).toBe(before.version);
    expect(after.trainedSamples).toBe(before.trainedSamples);
  });

  it('performs an adversarial robustness probe', () => {
    const probe = runAdversarialRobustnessProbe(highRiskSample);
    expect(probe.baseline.transactionId).toBe('tx-high');
    expect(probe.perturbed.transactionId).toBe('tx-high');
    expect(typeof probe.delta).toBe('number');
  });

  it('returns a defensive copy of model state', () => {
    const state = getModelState();
    state.weights[0] = 999;
    expect(getModelState().weights[0]).not.toBe(999);
  });
});
