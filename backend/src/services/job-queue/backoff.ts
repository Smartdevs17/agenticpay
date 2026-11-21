/**
 * backoff.ts — Issue #952: Background job queue with retries
 *
 * Pure helpers for computing retry delays. Keeping the maths side-effect free
 * makes the schedule deterministic and directly unit-testable: the caller can
 * inject a `random` source to remove jitter from assertions.
 */
import type { RetryPolicy } from './types.js';

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
  multiplier: 2,
  jitter: false,
};

/**
 * Delay before retrying after `failedAttempt` consecutive failures.
 *
 * The un-jittered delay is `initialDelayMs * multiplier ** (failedAttempt - 1)`,
 * capped at `maxDelayMs`. When the policy enables jitter the delay is
 * multiplied by a value in `[0, 1)` (full jitter) to spread retries out and
 * avoid a thundering herd.
 *
 * @param failedAttempt 1-based number of the attempt that just failed.
 * @param policy        Retry policy; defaults to `DEFAULT_RETRY_POLICY`.
 * @param random        Injectable RNG in `[0, 1)`, defaults to `Math.random`.
 */
export function computeBackoffDelayMs(
  failedAttempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  if (failedAttempt < 1) {
    throw new Error('failedAttempt must be >= 1');
  }
  if (policy.maxAttempts < 1) {
    throw new Error('maxAttempts must be >= 1');
  }
  if (policy.initialDelayMs < 0 || policy.maxDelayMs < 0) {
    throw new Error('backoff delays must be non-negative');
  }
  if (policy.multiplier < 1) {
    throw new Error('multiplier must be >= 1');
  }

  const exponential = policy.initialDelayMs * Math.pow(policy.multiplier, failedAttempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);
  const delay = policy.jitter ? capped * random() : capped;
  return Math.max(0, Math.round(delay));
}

/** True when another attempt is still permitted for the given attempt count. */
export function canRetry(attempts: number, policy: RetryPolicy): boolean {
  return attempts < policy.maxAttempts;
}
