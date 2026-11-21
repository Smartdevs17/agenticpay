/**
 * Transaction retry logic for deadlocks — Issue #887
 *
 * Wraps `prisma.$transaction` so transient write-conflict / deadlock
 * errors are retried with exponential backoff + jitter instead of
 * bubbling up as a request failure. Only errors known to be safely
 * retryable (deadlock, serialization failure, lock timeout) trigger a
 * retry; everything else rethrows immediately.
 */

import { Prisma } from '@prisma/client';

// Postgres error codes for conditions that are safe to retry:
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const RETRYABLE_PG_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
]);

// Prisma's own known-request-error codes for the same conditions.
// https://www.prisma.io/docs/orm/reference/error-reference
const RETRYABLE_PRISMA_CODES = new Set([
  'P2034', // transaction failed due to a write conflict or deadlock
]);

export interface RetryOptions {
  /** Maximum number of attempts, including the first one. Default 3. */
  maxAttempts?: number;
  /** Base delay in ms before the first retry. Default 50ms. */
  baseDelayMs?: number;
  /** Upper bound for the backoff delay. Default 1000ms. */
  maxDelayMs?: number;
  /** Called before each retry with the attempt number and error. */
  onRetry?: (attempt: number, error: unknown) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxAttempts: 3,
  baseDelayMs: 50,
  maxDelayMs: 1000,
};

function getPostgresErrorCode(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Prisma surfaces the underlying Postgres SQLSTATE on meta.code for
    // some drivers, and its own error code on `.code`.
    const meta = error.meta as { code?: unknown } | undefined;
    if (typeof meta?.code === 'string') return meta.code;
  }
  return undefined;
}

/**
 * Returns true if the error represents a transient conflict that is safe
 * to retry (deadlock, serialization failure, lock timeout).
 */
export function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (RETRYABLE_PRISMA_CODES.has(error.code)) return true;
  }

  const pgCode = getPostgresErrorCode(error);
  if (pgCode && RETRYABLE_PG_CODES.has(pgCode)) return true;

  // Fallback: some drivers only expose the SQLSTATE in the message text.
  if (error instanceof Error) {
    if (/deadlock detected/i.test(error.message)) return true;
    if (/could not serialize access/i.test(error.message)) return true;
    if (/lock timeout/i.test(error.message)) return true;
  }

  return false;
}

function backoffDelay(attempt: number, opts: Required<Omit<RetryOptions, 'onRetry'>>): number {
  const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
  // Full jitter — avoids retry storms when many requests deadlock together.
  return Math.floor(Math.random() * exp);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` and retries it with exponential backoff when it fails with a
 * deadlock or serialization-conflict error. Intended to wrap a single
 * `prisma.$transaction(...)` call:
 *
 * ```ts
 * const result = await withTransactionRetry(() =>
 *   prisma.$transaction(async (tx) => { ... })
 * );
 * ```
 */
export async function withTransactionRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let attempt = 0;
  let lastError: unknown;

  while (attempt < opts.maxAttempts) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error) || attempt >= opts.maxAttempts) {
        throw error;
      }
      options.onRetry?.(attempt, error);
      await sleep(backoffDelay(attempt, opts));
    }
  }

  // Unreachable, but keeps TypeScript satisfied.
  throw lastError;
}
