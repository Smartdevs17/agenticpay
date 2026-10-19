/**
 * proration.ts — Issue #812
 *
 * Proration maths for mid-cycle plan changes.
 *
 * Subscriptions are billed in arrears: the invoice raised when a period closes
 * covers the period that just ended. A mid-cycle plan change therefore splits
 * the period into *plan segments* and each segment's base price is charged in
 * proportion to the share of the period it covered.
 *
 * Expressed the conventional way, the adjustment for a change is
 * `remainingCharge - unusedCredit`: the customer is credited for the unused
 * time on the old plan and charged for the same time on the new one.
 */

import { roundMoney } from './money.js';

export type ProrationBehavior = 'create_prorations' | 'always_invoice' | 'none';

export const PRORATION_BEHAVIORS: readonly ProrationBehavior[] = [
  'create_prorations',
  'always_invoice',
  'none',
];

export interface PlanSegment {
  planId: string;
  /** ISO timestamp the plan became effective within the current period. */
  startedAt: string;
}

export interface SegmentShare extends PlanSegment {
  endedAt: string;
  /** Share of the full billing period covered by this segment (0..1). */
  fraction: number;
}

export interface ProrationQuote {
  fractionElapsed: number;
  fractionRemaining: number;
  /** Credit for the unused remainder of the current plan. */
  unusedCredit: number;
  /** Charge for the remainder of the period on the new plan. */
  remainingCharge: number;
  /** Net adjustment (positive = customer owes more, negative = customer saves). */
  net: number;
}

/** Share of `[periodStart, periodEnd]` that remains after `at` (clamped to 0..1). */
export function remainingFraction(periodStart: number, periodEnd: number, at: number): number {
  const length = periodEnd - periodStart;
  if (!(length > 0)) throw new RangeError('Billing period must have a positive length');
  const clamped = Math.min(Math.max(at, periodStart), periodEnd);
  return (periodEnd - clamped) / length;
}

export function quoteProration(input: {
  currentPrice: number;
  newPrice: number;
  periodStart: number;
  periodEnd: number;
  changeAt: number;
}): ProrationQuote {
  const fractionRemaining = remainingFraction(input.periodStart, input.periodEnd, input.changeAt);
  const unusedCredit = roundMoney(input.currentPrice * fractionRemaining);
  const remainingCharge = roundMoney(input.newPrice * fractionRemaining);

  return {
    fractionElapsed: roundMoney(1 - fractionRemaining, 6),
    fractionRemaining: roundMoney(fractionRemaining, 6),
    unusedCredit,
    remainingCharge,
    net: roundMoney(remainingCharge - unusedCredit),
  };
}

/**
 * Split `[from, periodEnd]` between the recorded plan segments. Segments are
 * ordered by start time; each one runs until the next segment starts.
 */
export function segmentShares(
  segments: PlanSegment[],
  periodStart: number,
  periodEnd: number,
  until: number = periodEnd,
): SegmentShare[] {
  const length = periodEnd - periodStart;
  if (!(length > 0)) throw new RangeError('Billing period must have a positive length');

  const ordered = [...segments].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );

  return ordered
    .map((segment, index) => {
      const start = Math.max(new Date(segment.startedAt).getTime(), periodStart);
      const nextStart = index + 1 < ordered.length ? new Date(ordered[index + 1].startedAt).getTime() : until;
      const end = Math.min(nextStart, until, periodEnd);
      return {
        planId: segment.planId,
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(Math.max(end, start)).toISOString(),
        fraction: Math.max(0, end - start) / length,
      };
    })
    .filter((share) => share.fraction > 0);
}
