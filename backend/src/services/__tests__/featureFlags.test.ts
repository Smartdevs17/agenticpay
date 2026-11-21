import { describe, it, expect, vi, beforeEach } from 'vitest';
import { featureFlagEngine } from '../featureFlags.js';

describe('FeatureFlagService Engine', () => {
  beforeEach(() => {
    // Reset flags or delete custom ones to ensure test isolation
    featureFlagEngine.deleteFlag('test-schedule-flag');
    featureFlagEngine.deleteFlag('test-ab-flag');
  });

  it('correctly schedules linear gradual rollouts', () => {
    const now = Date.now();
    const startTime = new Date(now - 10000); // 10s ago
    const endTime = new Date(now + 10000);   // 10s from now

    // Upsert flag with rollout schedule: from 10% to 90% over 20s
    featureFlagEngine.upsertFlag(
      'test-schedule-flag',
      true,
      0,
      [],
      [],
      {
        startPercentage: 10,
        endPercentage: 90,
        startTime,
        endTime,
      }
    );

    // Since the current time is exactly in the middle of startTime and endTime,
    // the effective rollout percentage should be ~50%
    const flag = featureFlagEngine.getFlag('test-schedule-flag')!;
    expect(flag).toBeDefined();
    
    // Trigger evaluations to confirm it works
    const results = Array.from({ length: 1000 }, (_, i) => 
      featureFlagEngine.evaluate('test-schedule-flag', `user_${i}`)
    );
    const trueCount = results.filter(Boolean).length;
    // We expect roughly 50% true counts (with some variance for hashing)
    expect(trueCount).toBeGreaterThan(400);
    expect(trueCount).toBeLessThan(600);
  });

  it('assigns A/B test variants deterministically based on weights', () => {
    // Upsert flag with 100% rollout and two variants: A (30% weight) and B (70% weight)
    featureFlagEngine.upsertFlag(
      'test-ab-flag',
      true,
      100,
      [],
      [
        { key: 'variant-A', value: { color: 'red' }, weight: 30 },
        { key: 'variant-B', value: { color: 'blue' }, weight: 70 },
      ]
    );

    // Evaluate variant multiple times
    const results = Array.from({ length: 1000 }, (_, i) =>
      featureFlagEngine.evaluateVariant('test-ab-flag', `user_${i}`)
    );

    const aCount = results.filter(v => v === 'variant-A').length;
    const bCount = results.filter(v => v === 'variant-B').length;

    // Check that we got variants assigned
    expect(aCount + bCount).toBe(1000);
    // Confirm variant counts reflect weights roughly (30% vs 70%)
    expect(aCount).toBeGreaterThan(200);
    expect(aCount).toBeLessThan(400);
    expect(bCount).toBeGreaterThan(600);
    expect(bCount).toBeLessThan(800);

    // Ensure deterministic assignment (evaluating again for the same user yields the same variant)
    expect(featureFlagEngine.evaluateVariant('test-ab-flag', 'user_abc')).toBe(
      featureFlagEngine.evaluateVariant('test-ab-flag', 'user_abc')
    );
  });
});
