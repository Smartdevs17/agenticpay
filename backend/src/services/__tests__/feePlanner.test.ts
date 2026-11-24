import { describe, expect, it } from 'vitest';
import { FeePlanner, FeePlannerError } from '../feePlanner.js';

const feed = (planner: FeePlanner, corridor: string, fees: number[]) =>
  fees.forEach((fee) => planner.observe(corridor, fee));

describe('FeePlanner — Issue #1326', () => {
  it('uses the live quote alone when there is no history anywhere', () => {
    const plan = new FeePlanner().plan('xlm->usdc', 'normal', 100);
    expect(plan).toMatchObject({ fee: 100n, source: 'live-only', priorWeight: 0 });
  });

  it('refuses to invent a fee with no history and no live quote', () => {
    expect(() => new FeePlanner().plan('xlm->usdc', 'normal')).toThrow(FeePlannerError);
  });

  it('builds an EWMA prior per corridor', () => {
    const planner = new FeePlanner({ alpha: 0.5 });
    planner.observe('a', 100);
    const prior = planner.observe('a', 200);
    expect(prior.samples).toBe(2);
    expect(prior.mean).toBe(150);
    expect(prior.variance).toBeCloseTo(0.5 * (0 + 100 * 50));
  });

  it('keeps corridors independent', () => {
    const planner = new FeePlanner();
    feed(planner, 'a', [100, 100, 100]);
    feed(planner, 'b', [900, 900, 900]);
    expect(planner.getPrior('a')!.mean).toBe(100);
    expect(planner.getPrior('b')!.mean).toBe(900);
  });

  it('trusts the prior more as samples accumulate', () => {
    const few = new FeePlanner();
    feed(few, 'a', [100]);
    const many = new FeePlanner();
    feed(many, 'a', Array(20).fill(100));

    const fewPlan = few.plan('a', 'low', 200);
    const manyPlan = many.plan('a', 'low', 200);
    expect(fewPlan.priorWeight).toBeCloseTo(0.05);
    expect(manyPlan.priorWeight).toBe(1);
    expect(manyPlan.fee).toBe(100n);
    expect(fewPlan.fee).toBeGreaterThan(manyPlan.fee);
  });

  it('adds more headroom for higher urgency on a noisy corridor', () => {
    const planner = new FeePlanner();
    feed(planner, 'a', [50, 150, 50, 150, 50, 150, 50, 150, 50, 150, 50, 150, 50, 150, 50, 150, 50, 150, 50, 150]);
    const low = planner.plan('a', 'low', 100).fee;
    const normal = planner.plan('a', 'normal', 100).fee;
    const high = planner.plan('a', 'high', 100).fee;
    expect(low < normal && normal < high).toBe(true);
  });

  it('falls back to a discounted global prior for a corridor with no history', () => {
    const planner = new FeePlanner();
    feed(planner, 'a', Array(20).fill(100));
    const plan = planner.plan('new-corridor', 'low', 300);
    expect(plan.source).toBe('global-prior');
    expect(plan.priorWeight).toBe(0.5);
    expect(plan.fee).toBe(200n);
  });

  it('plans from the prior alone when the live quote is unavailable', () => {
    const planner = new FeePlanner();
    feed(planner, 'a', Array(5).fill(120));
    expect(planner.plan('a', 'low')).toMatchObject({ fee: 120n, source: 'prior-only' });
  });

  it('never exceeds the live quote by more than the configured multiple', () => {
    const planner = new FeePlanner({ maxLiveMultiple: 2 });
    feed(planner, 'a', Array(20).fill(10_000));
    expect(planner.plan('a', 'low', 100).fee).toBe(200n);
  });

  it('rounds the plan up to a whole unit', () => {
    const planner = new FeePlanner();
    feed(planner, 'a', Array(20).fill(100.2));
    expect(planner.plan('a', 'low', 100.2).fee).toBe(101n);
  });

  it('rejects invalid fees, corridors, urgencies and config', () => {
    const planner = new FeePlanner();
    expect(() => planner.observe('', 1)).toThrow(FeePlannerError);
    expect(() => planner.observe('a', -1)).toThrow(FeePlannerError);
    expect(() => planner.observe('a', Number.NaN)).toThrow(FeePlannerError);
    expect(() => planner.plan('a', 'normal', Infinity)).toThrow(FeePlannerError);
    expect(() => planner.plan('a', 'urgent' as never, 1)).toThrow(FeePlannerError);
    expect(() => new FeePlanner({ alpha: 0 })).toThrow(FeePlannerError);
    expect(() => new FeePlanner({ fullTrustSamples: 0 })).toThrow(FeePlannerError);
  });

  it('is deterministic for the same history and quote', () => {
    const run = () => {
      const planner = new FeePlanner();
      feed(planner, 'a', [80, 120, 95, 110, 100]);
      return planner.plan('a', 'high', 105);
    };
    expect(run()).toEqual(run());
  });
});
