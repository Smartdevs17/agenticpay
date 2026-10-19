import { describe, expect, it, beforeEach } from 'vitest';
import { FunnelTrackingService } from '../funnel-tracking.js';

describe('FunnelTrackingService — Issue #853', () => {
  let service: FunnelTrackingService;

  beforeEach(() => {
    service = new FunnelTrackingService();
  });

  it('creates a funnel with steps', () => {
    const f = service.createFunnel({
      name: 'Checkout Funnel',
      steps: [
        { id: 'visit', name: 'Visit' },
        { id: 'add_to_cart', name: 'Add to Cart' },
        { id: 'checkout', name: 'Checkout' },
        { id: 'purchase', name: 'Purchase' },
      ],
    });
    expect(f.steps).toHaveLength(4);
    expect(f.steps[0].order).toBe(0);
  });

  it('rejects funnel with less than 2 steps', () => {
    expect(() => service.createFunnel({ name: 'Bad', steps: [{ id: 'a', name: 'A' }] })).toThrow();
  });

  it('rejects duplicate step ids', () => {
    expect(() =>
      service.createFunnel({
        name: 'Bad',
        steps: [
          { id: 'a', name: 'A' },
          { id: 'a', name: 'A2' },
        ],
      }),
    ).toThrow();
  });

  it('tracks events and computes conversion rates', () => {
    const f = service.createFunnel({
      name: 'Simple',
      steps: [
        { id: 'step1', name: 'Step 1' },
        { id: 'step2', name: 'Step 2' },
        { id: 'step3', name: 'Step 3' },
      ],
    });
    const now = new Date('2026-01-01T00:00:00Z');
    // 10 users enter step1
    for (let i = 0; i < 10; i++) {
      service.track({ funnelId: f.id, userId: `u${i}`, stepId: 'step1', timestamp: new Date(now.getTime() + i * 1000) });
    }
    // 6 users proceed to step2
    for (let i = 0; i < 6; i++) {
      service.track({ funnelId: f.id, userId: `u${i}`, stepId: 'step2', timestamp: new Date(now.getTime() + 60000 + i * 1000) });
    }
    // 3 users complete step3
    for (let i = 0; i < 3; i++) {
      service.track({ funnelId: f.id, userId: `u${i}`, stepId: 'step3', timestamp: new Date(now.getTime() + 120000 + i * 1000) });
    }

    const stats = service.getFunnelStats(f.id);
    expect(stats.totalUsers).toBe(10);
    expect(stats.totalConverted).toBe(3);
    expect(stats.overallConversionRate).toBeCloseTo(0.3);
    expect(stats.steps[0].entered).toBe(10);
    expect(stats.steps[1].entered).toBe(6);
    expect(stats.steps[2].entered).toBe(3);
    expect(stats.steps[1].stepConversionRate).toBeCloseTo(0.6);
    expect(stats.steps[2].conversionRate).toBeCloseTo(0.3);
  });

  it('computes avg time to next step', () => {
    const f = service.createFunnel({
      name: 'Time',
      steps: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    });
    const base = new Date('2026-01-01T10:00:00Z');
    service.track({ funnelId: f.id, userId: 'u1', stepId: 'a', timestamp: base });
    service.track({ funnelId: f.id, userId: 'u1', stepId: 'b', timestamp: new Date(base.getTime() + 5000) });
    service.track({ funnelId: f.id, userId: 'u2', stepId: 'a', timestamp: base });
    service.track({ funnelId: f.id, userId: 'u2', stepId: 'b', timestamp: new Date(base.getTime() + 15000) });

    const stats = service.getFunnelStats(f.id);
    expect(stats.steps[0].avgTimeToNextMs).toBeCloseTo(10000);
    expect(stats.steps[0].medianTimeToNextMs).toBeGreaterThan(0);
    expect(stats.avgTotalConversionTimeMs).toBeCloseTo(10000);
  });

  it('respects conversion window', () => {
    const f = service.createFunnel({
      name: 'Window',
      steps: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      conversionWindowMs: 60 * 1000, // 1 min
    });
    const base = new Date('2026-01-01T10:00:00Z');
    service.track({ funnelId: f.id, userId: 'u1', stepId: 'a', timestamp: base });
    service.track({ funnelId: f.id, userId: 'u1', stepId: 'b', timestamp: new Date(base.getTime() + 120000) }); // 2 min later > window

    const stats = service.getFunnelStats(f.id);
    expect(stats.totalConverted).toBe(0);
    expect(stats.overallConversionRate).toBe(0);
  });

  it('tracks user journey correctly', () => {
    const f = service.createFunnel({
      name: 'Journey',
      steps: [
        { id: 'view', name: 'View' },
        { id: 'click', name: 'Click' },
        { id: 'buy', name: 'Buy' },
      ],
    });
    const base = new Date('2026-01-01T00:00:00Z');
    service.track({ funnelId: f.id, userId: 'alice', stepId: 'view', timestamp: base });
    service.track({ funnelId: f.id, userId: 'alice', stepId: 'click', timestamp: new Date(base.getTime() + 1000) });
    service.track({ funnelId: f.id, userId: 'alice', stepId: 'buy', timestamp: new Date(base.getTime() + 2000) });

    const journey = service.getUserJourney('alice', f.id);
    expect(journey).not.toBeNull();
    expect(journey!.completed).toBe(true);
    expect(journey!.steps).toHaveLength(3);
    expect(journey!.conversionTimeMs).toBe(2000);
  });

  it('identifies drop-off correctly', () => {
    const f = service.createFunnel({
      name: 'Dropoff',
      steps: [
        { id: 's1', name: 'S1' },
        { id: 's2', name: 'S2' },
        { id: 's3', name: 'S3' },
      ],
    });
    const base = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 100; i++) service.track({ funnelId: f.id, userId: `u${i}`, stepId: 's1', timestamp: base });
    for (let i = 0; i < 80; i++) service.track({ funnelId: f.id, userId: `u${i}`, stepId: 's2', timestamp: new Date(base.getTime() + 1000) });
    for (let i = 0; i < 10; i++) service.track({ funnelId: f.id, userId: `u${i}`, stepId: 's3', timestamp: new Date(base.getTime() + 2000) });

    const stats = service.getFunnelStats(f.id);
    const worst = service.getTopDropOff(stats);
    expect(worst).not.toBeNull();
    expect(worst!.stepId).toBe('s3'); // 70 drop from 80 = 87.5% drop
    expect(worst!.dropOffRate).toBeGreaterThan(0.5);
  });

  it('exports CSV', () => {
    const f = service.createFunnel({
      name: 'CSV',
      steps: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    });
    service.track({ funnelId: f.id, userId: 'u1', stepId: 'a', timestamp: new Date() });
    const csv = service.exportCsv(f.id);
    expect(csv).toContain('stepId,stepName');
    expect(csv).toContain('a');
  });

  it('validates step existence on track', () => {
    const f = service.createFunnel({
      name: 'Val',
      steps: [
        { id: 'x', name: 'X' },
        { id: 'y', name: 'Y' },
      ],
    });
    expect(() => service.track({ funnelId: f.id, userId: 'u1', stepId: 'unknown', timestamp: new Date() })).toThrow();
  });
});
