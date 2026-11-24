import { describe, expect, it } from 'vitest';
import {
  accrue,
  isSettlementDue,
  newMeter,
  rollPeriod,
  startUsage,
  stopUsage,
  takeSettlement,
  validatePlan,
  type MeterPlan,
} from '../meteredBilling';

const plan: MeterPlan = { ratePerSecond: 10n, freeSeconds: 0, periodCap: null, settlementThreshold: 100n };
const T0 = 1_000_000;

describe('validatePlan', () => {
  it('accepts a valid plan and rejects bad fields', () => {
    expect(validatePlan(plan)).toBeNull();
    expect(validatePlan({ ...plan, ratePerSecond: 0n })).toMatch(/ratePerSecond/);
    expect(validatePlan({ ...plan, freeSeconds: -1 })).toMatch(/freeSeconds/);
    expect(validatePlan({ ...plan, freeSeconds: 1.5 })).toMatch(/freeSeconds/);
    expect(validatePlan({ ...plan, periodCap: -1n })).toMatch(/periodCap/);
    expect(validatePlan({ ...plan, settlementThreshold: 0n })).toMatch(/settlementThreshold/);
  });
});

describe('accrue', () => {
  it('charges per whole second of running usage', () => {
    const s = accrue(plan, startUsage(newMeter(T0), T0), T0 + 5_000);
    expect(s.usedSeconds).toBe(5);
    expect(s.unsettled).toBe(50n);
  });

  it('carries partial seconds so many ticks equal one long tick', () => {
    let many = startUsage(newMeter(T0), T0);
    for (let i = 1; i <= 10; i++) many = accrue(plan, many, T0 + i * 700);
    const one = accrue(plan, startUsage(newMeter(T0), T0), T0 + 7_000);
    expect(many.unsettled).toBe(one.unsettled);
    expect(many.usedSeconds).toBe(7);
    expect(many.carryMs).toBe(0);
  });

  it('keeps the leftover milliseconds', () => {
    const s = accrue(plan, startUsage(newMeter(T0), T0), T0 + 2_900);
    expect(s.usedSeconds).toBe(2);
    expect(s.carryMs).toBe(900);
  });

  it('charges nothing when stopped, or when the clock runs backwards', () => {
    const idle = newMeter(T0);
    expect(accrue(plan, idle, T0 + 9_000)).toBe(idle);
    const running = startUsage(newMeter(T0), T0);
    expect(accrue(plan, running, T0 - 5_000)).toBe(running);
  });

  it('does not charge the free seconds, then charges after them', () => {
    const free = { ...plan, freeSeconds: 3 };
    const started = startUsage(newMeter(T0), T0);
    expect(accrue(free, started, T0 + 2_000).unsettled).toBe(0n);
    expect(accrue(free, started, T0 + 3_000).unsettled).toBe(0n);
    // 5 seconds used, 3 free: 2 charged.
    expect(accrue(free, started, T0 + 5_000).unsettled).toBe(20n);
  });

  it('charges only the seconds past the free allowance across ticks', () => {
    const free = { ...plan, freeSeconds: 3 };
    let s = startUsage(newMeter(T0), T0);
    s = accrue(free, s, T0 + 2_000);
    s = accrue(free, s, T0 + 6_000);
    expect(s.usedSeconds).toBe(6);
    expect(s.unsettled).toBe(30n);
  });

  it('never charges past the period cap', () => {
    const capped = { ...plan, periodCap: 35n };
    const s = accrue(capped, startUsage(newMeter(T0), T0), T0 + 10_000);
    expect(s.unsettled).toBe(35n);
    expect(s.chargedInPeriod).toBe(35n);
    expect(accrue(capped, s, T0 + 20_000).unsettled).toBe(35n);
  });
});

describe('start and stop', () => {
  it('ignores a second start and stops counting after stop', () => {
    const started = startUsage(newMeter(T0), T0);
    expect(startUsage(started, T0 + 3_000)).toBe(started);
    const stopped = stopUsage(plan, started, T0 + 4_000);
    expect(stopped.running).toBe(false);
    expect(stopped.unsettled).toBe(40n);
    expect(accrue(plan, stopped, T0 + 90_000)).toBe(stopped);
  });

  it('does not bill the idle gap when usage restarts', () => {
    let s = stopUsage(plan, startUsage(newMeter(T0), T0), T0 + 2_000);
    s = startUsage(s, T0 + 60_000);
    s = accrue(plan, s, T0 + 61_000);
    expect(s.unsettled).toBe(30n);
  });
});

describe('settlement', () => {
  it('is due only at or above the threshold', () => {
    const s = accrue(plan, startUsage(newMeter(T0), T0), T0 + 9_000);
    expect(isSettlementDue(plan, s)).toBe(false);
    expect(takeSettlement(plan, s, 'm1', T0).batch).toBeNull();
    expect(isSettlementDue(plan, accrue(plan, s, T0 + 10_000))).toBe(true);
  });

  it('takes the whole unsettled amount in one batch and clears it', () => {
    const s = accrue(plan, startUsage(newMeter(T0), T0), T0 + 12_000);
    const { state, batch } = takeSettlement(plan, s, 'm1', T0);
    expect(batch).toEqual({ id: `m1:${T0}-${T0 + 12_000}`, amount: 120n, fromMs: T0, toMs: T0 + 12_000 });
    expect(state.unsettled).toBe(0n);
    expect(takeSettlement(plan, state, 'm1', T0 + 12_000).batch).toBeNull();
  });

  it('can force a batch below the threshold, but never an empty one', () => {
    const s = accrue(plan, startUsage(newMeter(T0), T0), T0 + 2_000);
    expect(takeSettlement(plan, s, 'm1', T0, true).batch?.amount).toBe(20n);
    expect(takeSettlement(plan, newMeter(T0), 'm1', T0, true).batch).toBeNull();
  });

  it('gives a retried settlement the same id', () => {
    const s = accrue(plan, startUsage(newMeter(T0), T0), T0 + 12_000);
    expect(takeSettlement(plan, s, 'm1', T0).batch?.id).toBe(takeSettlement(plan, s, 'm1', T0).batch?.id);
  });
});

describe('rollPeriod', () => {
  it('resets the period counters but keeps unsettled usage', () => {
    const capped = { ...plan, periodCap: 50n };
    const s = accrue(capped, startUsage(newMeter(T0), T0), T0 + 10_000);
    expect(s.unsettled).toBe(50n);
    const next = rollPeriod(s);
    expect(next.usedSeconds).toBe(0);
    expect(next.chargedInPeriod).toBe(0n);
    expect(next.unsettled).toBe(50n);
    expect(accrue(capped, next, T0 + 12_000).unsettled).toBe(70n);
  });
});
