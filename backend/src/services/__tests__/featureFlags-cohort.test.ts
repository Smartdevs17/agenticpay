import { describe, it, expect, beforeEach } from 'vitest';
import { featureFlagEngine } from '../featureFlags.js';

describe('FeatureFlagService cohorts (#1354)', () => {
  beforeEach(() => {
    featureFlagEngine.deleteFlag('cohort-flag');
    featureFlagEngine.upsertFlag('cohort-flag', true, 0, [], [
      { key: 'control', value: { ui: 'a' }, weight: 50 },
      { key: 'treatment', value: { ui: 'b' }, weight: 50 },
    ]);
  });

  it('forces enablement for explicit cohort members', () => {
    featureFlagEngine.upsertCohort('cohort-flag', {
      id: 'beta',
      name: 'Beta testers',
      members: ['user-beta'],
      forceEnabled: true,
      variantKey: 'treatment',
    });

    expect(featureFlagEngine.evaluate('cohort-flag', 'user-beta')).toBe(true);
    expect(featureFlagEngine.evaluate('cohort-flag', 'user-other')).toBe(false);
    expect(featureFlagEngine.evaluateVariant('cohort-flag', 'user-beta')).toBe('treatment');
  });

  it('assigns percentage cohorts deterministically', () => {
    featureFlagEngine.upsertCohort('cohort-flag', {
      id: 'pct-50',
      name: 'Half traffic',
      percentage: 50,
      forceEnabled: true,
    });

    const results = Array.from({ length: 400 }, (_, i) =>
      featureFlagEngine.isInCohort('cohort-flag', 'pct-50', `u_${i}`)
    );
    const inCohort = results.filter(Boolean).length;
    expect(inCohort).toBeGreaterThan(140);
    expect(inCohort).toBeLessThan(260);

    const first = featureFlagEngine.isInCohort('cohort-flag', 'pct-50', 'stable-user');
    const second = featureFlagEngine.isInCohort('cohort-flag', 'pct-50', 'stable-user');
    expect(first).toBe(second);
  });

  it('returns cohort-aware evaluation payloads', () => {
    featureFlagEngine.upsertCohort('cohort-flag', {
      id: 'vip',
      name: 'VIP',
      members: ['vip-1'],
      forceEnabled: true,
      variantKey: 'control',
    });

    const evalResult = featureFlagEngine.evaluateWithCohort('cohort-flag', 'vip-1');
    expect(evalResult).toEqual({
      enabled: true,
      cohortId: 'vip',
      variant: 'control',
    });

    const outsider = featureFlagEngine.evaluateWithCohort('cohort-flag', 'nobody');
    expect(outsider.enabled).toBe(false);
    expect(outsider.cohortId).toBeNull();
  });

  it('lists and removes cohorts', () => {
    featureFlagEngine.upsertCohort('cohort-flag', {
      id: 'tmp',
      name: 'Temporary',
      percentage: 10,
    });
    expect(featureFlagEngine.listCohorts('cohort-flag').map((c) => c.id)).toContain('tmp');
    expect(featureFlagEngine.removeCohort('cohort-flag', 'tmp')).toBe(true);
    expect(featureFlagEngine.listCohorts('cohort-flag')).toHaveLength(0);
  });
});
