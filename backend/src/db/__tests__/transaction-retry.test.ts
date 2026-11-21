import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { withTransactionRetry, isRetryableTransactionError } from '../transaction-retry.js';

function deadlockError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock', {
    code: 'P2034',
    clientVersion: '5.0.0',
  });
}

describe('isRetryableTransactionError', () => {
  it('treats Prisma P2034 as retryable', () => {
    expect(isRetryableTransactionError(deadlockError())).toBe(true);
  });

  it('treats a raw Postgres deadlock message as retryable', () => {
    expect(isRetryableTransactionError(new Error('deadlock detected while updating payments'))).toBe(true);
  });

  it('does not treat unrelated errors as retryable', () => {
    expect(isRetryableTransactionError(new Error('column "foo" does not exist'))).toBe(false);
  });
});

describe('withTransactionRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withTransactionRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries retryable failures until success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(deadlockError())
      .mockRejectedValueOnce(deadlockError())
      .mockResolvedValueOnce('recovered');

    const onRetry = vi.fn();
    const result = await withTransactionRetry(fn, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2, onRetry });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('rethrows immediately for non-retryable errors', async () => {
    const err = new Error('validation failed');
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withTransactionRetry(fn, { maxAttempts: 5, baseDelayMs: 1 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts and surfaces the last error', async () => {
    const fn = vi.fn().mockRejectedValue(deadlockError());

    await expect(withTransactionRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
