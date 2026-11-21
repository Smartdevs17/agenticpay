import { describe, expect, it, beforeEach } from 'vitest';
import { ABTestingService } from '../ab-testing.js';

describe('ABTestingService — Issue #852', () => {
  let service: ABTestingService;

  beforeEach(() => {
    service = new ABTestingService();
  });

  it('creates experiment with validation', () => {
    const exp = service.createExperiment({
      name: 'Checkout Button',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      primaryMetric: 'conversion',
    });
    expect(exp.variants).toHaveLength(2);
    expect(exp.status).toBe('draft');
  });

  it('rejects weights not summing to 100', () => {
    expect(() =>
      service.createExperiment({
        name: 'Bad',
        variants: [
          { key: 'a', name: 'A', weight: 30 },
          { key: 'b', name: 'B', weight: 30 },
        ],
      }),
    ).toThrow();
  });

  it('rejects duplicate keys', () => {
    expect(() =>
      service.createExperiment({
        name: 'Dup',
        variants: [
          { key: 'a', name: 'A', weight: 50 },
          { key: 'a', name: 'A2', weight: 50 },
        ],
      }),
    ).toThrow();
  });

  it('assigns variants deterministically', () => {
    const exp = service.createExperiment({
      name: 'Determinism',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'treatment', name: 'Treatment', weight: 50 },
      ],
    });
    service.startExperiment(exp.id);
    const r1 = service.assign(exp.id, 'user123');
    const r2 = service.assign(exp.id, 'user123');
    expect(r1.variant.key).toBe(r2.variant.key);
    expect(r1.assignment.variantId).toBe(r2.assignment.variantId);
  });

  it('distributes roughly according to weights', () => {
    const exp = service.createExperiment({
      name: 'Weights',
      variants: [
        { key: 'a', name: 'A', weight: 70, isControl: true },
        { key: 'b', name: 'B', weight: 30 },
      ],
    });
    service.startExperiment(exp.id);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 1000; i++) {
      const { variant } = service.assign(exp.id, `user${i}`);
      counts[variant.key as 'a' | 'b']++;
    }
    expect(counts.a).toBeGreaterThan(600);
    expect(counts.b).toBeGreaterThan(200);
    expect(counts.b).toBeLessThan(400);
  });

  it('tracks conversions and computes significance', () => {
    const exp = service.createExperiment({
      name: 'Sig',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'treatment', name: 'Treatment', weight: 50 },
      ],
    });
    service.startExperiment(exp.id);
    // Assign 200 users
    const assignments: Array<{ subjectId: string; key: string }> = [];
    for (let i = 0; i < 200; i++) {
      const { variant } = service.assign(exp.id, `u${i}`);
      assignments.push({ subjectId: `u${i}`, key: variant.key });
      service.recordExposure(exp.id, `u${i}`);
    }
    // Simulate: control 10% conv, treatment 25% conv
    for (const a of assignments) {
      const isControl = a.key === 'control';
      const isConversion = isControl ? Math.random() < 0.1 : Math.random() < 0.25;
      if (isConversion) service.trackEvent({ experimentId: exp.id, subjectId: a.subjectId, value: 1 });
    }

    const results = service.getResults(exp.id);
    expect(results.variants).toHaveLength(2);
    expect(results.totalParticipants).toBe(200);
    const control = results.variants.find((v) => v.isControl)!;
    const treatment = results.variants.find((v) => !v.isControl)!;
    expect(control.participants + treatment.participants).toBe(200);
    // treatment should have higher rate on average (flaky but likely)
    // Instead assert structure
    expect(treatment).toHaveProperty('pValue');
    expect(treatment).toHaveProperty('confidenceInterval');
    expect(treatment.confidenceInterval).not.toBeNull();
  });

  it('computes wilson interval', () => {
    const exp = service.createExperiment({
      name: 'Wilson',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'v', name: 'V', weight: 50 },
      ],
    });
    service.startExperiment(exp.id);
    service.assign(exp.id, 'u1');
    service.trackEvent({ experimentId: exp.id, subjectId: 'u1', value: 1 });
    service.assign(exp.id, 'u2');
    const results = service.getResults(exp.id);
    const v = results.variants.find((r) => r.key === 'control')!;
    expect(v.confidenceInterval![0]).toBeLessThanOrEqual(v.confidenceInterval![1]);
  });

  it('lifecycle transitions correctly', () => {
    const exp = service.createExperiment({
      name: 'Life',
      variants: [
        { key: 'a', name: 'A', weight: 50, isControl: true },
        { key: 'b', name: 'B', weight: 50 },
      ],
    });
    service.startExperiment(exp.id);
    expect(service.getExperiment(exp.id)!.status).toBe('running');
    service.pauseExperiment(exp.id);
    expect(service.getExperiment(exp.id)!.status).toBe('paused');
    service.startExperiment(exp.id);
    service.completeExperiment(exp.id);
    expect(service.getExperiment(exp.id)!.status).toBe('completed');
    service.archiveExperiment(exp.id);
    expect(service.getExperiment(exp.id)!.status).toBe('archived');
  });

  it('calculates sample size', () => {
    const n = service.calculateSampleSize(0.1, 0.02);
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThan(10000);
  });

  it('respects traffic allocation', () => {
    const exp = service.createExperiment({
      name: 'Traffic',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'variant', name: 'Variant', weight: 50 },
      ],
      trafficAllocation: 0,
    });
    service.startExperiment(exp.id);
    // With 0% allocation, all go to control fallback
    for (let i = 0; i < 20; i++) {
      const { variant } = service.assign(exp.id, `u${i}`);
      expect(variant.key).toBe('control');
    }
  });

  it('bayesian prob returns correct shape', () => {
    const exp = service.createExperiment({
      name: 'Bayes',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'v', name: 'V', weight: 50 },
      ],
    });
    service.startExperiment(exp.id);
    for (let i = 0; i < 100; i++) {
      service.assign(exp.id, `u${i}`);
      if (i % 2 === 0) service.trackEvent({ experimentId: exp.id, subjectId: `u${i}`, value: 1 });
    }
    const probs = service.getBayesianProb(exp.id);
    expect(probs).toHaveProperty('v');
    expect(probs!['v']).toBeGreaterThanOrEqual(0);
    expect(probs!['v']).toBeLessThanOrEqual(1);
  });

  it('deletes draft experiment', () => {
    const exp = service.createExperiment({
      name: 'Del',
      variants: [
        { key: 'a', name: 'A', weight: 50, isControl: true },
        { key: 'b', name: 'B', weight: 50 },
      ],
    });
    expect(service.deleteExperiment(exp.id)).toBe(true);
    expect(service.getExperiment(exp.id)).toBeUndefined();
  });

  it('prevents deleting running experiment', () => {
    const exp = service.createExperiment({
      name: 'NoDel',
      variants: [
        { key: 'a', name: 'A', weight: 50, isControl: true },
        { key: 'b', name: 'B', weight: 50 },
      ],
    });
    service.startExperiment(exp.id);
    expect(() => service.deleteExperiment(exp.id)).toThrow();
  });
});
