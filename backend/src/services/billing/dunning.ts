/**
 * dunning.ts — Issue #813
 *
 * Dunning management: when a subscription invoice fails to collect, payment
 * is retried on a merchant-configurable schedule. The schedule is a list of
 * day offsets measured from the *initial* failure, e.g. `[1, 3, 5, 7]` retries
 * one, three, five and seven days later. When every retry has failed the
 * configured final action is taken.
 */

export type DunningFinalAction = 'cancel_subscription' | 'mark_uncollectible';
export type DunningStatus = 'retrying' | 'recovered' | 'exhausted' | 'stopped';

export interface DunningConfig {
  merchantId: string;
  retryScheduleDays: number[];
  finalAction: DunningFinalAction;
  updatedAt?: string;
}

export interface DunningAttempt {
  /** 0 is the original collection attempt, 1..n are retries. */
  attempt: number;
  attemptedAt: string;
  success: boolean;
  failureReason?: string;
}

export interface DunningState {
  status: DunningStatus;
  startedAt: string;
  /** Snapshot of the schedule when dunning started; later config edits don't apply. */
  retryScheduleDays: number[];
  finalAction: DunningFinalAction;
  retriesAttempted: number;
  nextRetryAt?: string;
  history: DunningAttempt[];
  endedAt?: string;
}

export const DEFAULT_RETRY_SCHEDULE_DAYS: readonly number[] = [1, 3, 5, 7];
export const DEFAULT_FINAL_ACTION: DunningFinalAction = 'cancel_subscription';
export const MAX_RETRY_ATTEMPTS = 10;
export const MAX_RETRY_WINDOW_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Returns a validation error for a retry schedule, or `null` when valid. */
export function validateRetrySchedule(days: number[]): string | null {
  if (!Array.isArray(days) || days.length === 0) return 'retryScheduleDays must contain at least one retry';
  if (days.length > MAX_RETRY_ATTEMPTS) return `retryScheduleDays supports at most ${MAX_RETRY_ATTEMPTS} retries`;

  let previous = 0;
  for (const day of days) {
    if (!(typeof day === 'number' && Number.isFinite(day) && day > 0)) {
      return 'retryScheduleDays entries must be positive numbers of days';
    }
    if (day <= previous) return 'retryScheduleDays must be strictly ascending';
    if (day > MAX_RETRY_WINDOW_DAYS) return `retryScheduleDays cannot extend beyond ${MAX_RETRY_WINDOW_DAYS} days`;
    previous = day;
  }
  return null;
}

/**
 * When the next retry is due, given how many retries have already run.
 * Returns `undefined` once the schedule is exhausted.
 */
export function nextRetryAt(startedAt: number, scheduleDays: number[], retriesAttempted: number): number | undefined {
  const offset = scheduleDays[retriesAttempted];
  return offset === undefined ? undefined : startedAt + offset * DAY_MS;
}
