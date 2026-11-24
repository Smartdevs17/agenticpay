// Usage-metered billing with a per-second settlement accumulator (issue #1330).
//
// Pure functions over plain values: no clock, timers, database or network.
// Callers pass the current time in, so every rule is testable. Amounts are
// bigint in the smallest currency unit (for example stroops) to avoid float
// drift. The accumulator counts whole seconds and carries the leftover
// milliseconds forward, so splitting one usage period into many ticks bills
// exactly the same as one long tick.

export interface MeterPlan {
  /** Price of one second of usage, in smallest units. */
  ratePerSecond: bigint;
  /** Seconds at the start of each billing period that are not charged. */
  freeSeconds: number;
  /** Most that may be charged in one billing period; null means no cap. */
  periodCap: bigint | null;
  /** Accrued, unsettled amount at which a settlement batch is due. */
  settlementThreshold: bigint;
}

export interface MeterState {
  /** Time up to which usage has been counted, in epoch milliseconds. */
  accruedUntilMs: number;
  /** Milliseconds already counted toward the next whole second. */
  carryMs: number;
  /** Whole seconds of usage counted in this period (free seconds included). */
  usedSeconds: number;
  /** Charged but not yet settled. */
  unsettled: bigint;
  /** Total charged in this period; the cap applies to this. */
  chargedInPeriod: bigint;
  /** Whether usage is currently running. */
  running: boolean;
}

export interface SettlementBatch {
  /** Stable id so a retried settlement can be recognised as a duplicate. */
  id: string;
  amount: bigint;
  /** The usage period the batch covers, in epoch milliseconds. */
  fromMs: number;
  toMs: number;
}

export function validatePlan(plan: MeterPlan): string | null {
  if (plan.ratePerSecond <= 0n) return 'ratePerSecond must be positive.';
  if (!Number.isInteger(plan.freeSeconds) || plan.freeSeconds < 0) return 'freeSeconds must be a non-negative integer.';
  if (plan.periodCap !== null && plan.periodCap < 0n) return 'periodCap must not be negative.';
  if (plan.settlementThreshold <= 0n) return 'settlementThreshold must be positive.';
  return null;
}

export function newMeter(nowMs: number): MeterState {
  return { accruedUntilMs: nowMs, carryMs: 0, usedSeconds: 0, unsettled: 0n, chargedInPeriod: 0n, running: false };
}

/** Starts counting usage from `nowMs`. Starting a running meter changes nothing. */
export function startUsage(state: MeterState, nowMs: number): MeterState {
  if (state.running) return state;
  return { ...state, running: true, accruedUntilMs: nowMs, carryMs: 0 };
}

/**
 * Counts usage up to `nowMs` and charges for the whole seconds that passed.
 * A clock that runs backwards, or a stopped meter, charges nothing and leaves
 * the state untouched.
 */
export function accrue(plan: MeterPlan, state: MeterState, nowMs: number): MeterState {
  if (!state.running || nowMs <= state.accruedUntilMs) return state;

  const totalMs = state.carryMs + (nowMs - state.accruedUntilMs);
  const wholeSeconds = Math.floor(totalMs / 1000);
  const carryMs = totalMs - wholeSeconds * 1000;

  const usedSeconds = state.usedSeconds + wholeSeconds;
  const chargeableBefore = Math.max(0, state.usedSeconds - plan.freeSeconds);
  const chargeableAfter = Math.max(0, usedSeconds - plan.freeSeconds);

  let charge = BigInt(chargeableAfter - chargeableBefore) * plan.ratePerSecond;
  if (plan.periodCap !== null) {
    const room = plan.periodCap - state.chargedInPeriod;
    if (charge > room) charge = room > 0n ? room : 0n;
  }

  return {
    ...state,
    accruedUntilMs: nowMs,
    carryMs,
    usedSeconds,
    unsettled: state.unsettled + charge,
    chargedInPeriod: state.chargedInPeriod + charge,
  };
}

/** Stops usage after counting everything up to `nowMs`. */
export function stopUsage(plan: MeterPlan, state: MeterState, nowMs: number): MeterState {
  const counted = accrue(plan, state, nowMs);
  return { ...counted, running: false, carryMs: 0 };
}

export function isSettlementDue(plan: MeterPlan, state: MeterState): boolean {
  return state.unsettled >= plan.settlementThreshold;
}

/**
 * Takes the unsettled amount out of the meter as one batch. Returns null when
 * nothing is due. With `force` the batch is taken even below the threshold
 * (used when a period closes). The batch id is derived from the period it
 * covers, so a retry of the same settlement carries the same id.
 */
export function takeSettlement(
  plan: MeterPlan,
  state: MeterState,
  meterId: string,
  lastSettledMs: number,
  force = false,
): { state: MeterState; batch: SettlementBatch | null } {
  if (state.unsettled <= 0n || (!force && !isSettlementDue(plan, state))) return { state, batch: null };
  const batch: SettlementBatch = {
    id: `${meterId}:${lastSettledMs}-${state.accruedUntilMs}`,
    amount: state.unsettled,
    fromMs: lastSettledMs,
    toMs: state.accruedUntilMs,
  };
  return { state: { ...state, unsettled: 0n }, batch };
}

/** Starts a new billing period: counters reset, unsettled usage is kept. */
export function rollPeriod(state: MeterState): MeterState {
  return { ...state, usedSeconds: 0, chargedInPeriod: 0n, carryMs: state.running ? state.carryMs : 0 };
}
