import { describe, expect, it, vi } from 'vitest';
import { createIdempotencyKey, withIdempotencyRetry } from '../idempotency.js';

describe('idempotency retry helpers', () => {
  it('creates namespaced UUID keys', () => {
    expect(createIdempotencyKey('payment')).toMatch(
      /^payment_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('reuses the same key until a retry succeeds', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ accepted: true });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      withIdempotencyRetry(operation, {
        idempotencyKey: 'payment_stable',
        maxRetries: 2,
        baseDelayMs: 10,
        sleep,
      })
    ).resolves.toEqual({ accepted: true });
    expect(operation.mock.calls.map(([context]) => context)).toEqual([
      { idempotencyKey: 'payment_stable', attempt: 0 },
      { idempotencyKey: 'payment_stable', attempt: 1 },
    ]);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it('surfaces the last failure after the retry budget', async () => {
    const failure = new Error('still unavailable');
    const operation = vi.fn().mockRejectedValue(failure);

    await expect(
      withIdempotencyRetry(operation, {
        idempotencyKey: 'payment_failure',
        maxRetries: 1,
        sleep: async () => undefined,
      })
    ).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry errors rejected by the predicate', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('invalid request'));
    await expect(
      withIdempotencyRetry(operation, {
        shouldRetry: () => false,
      })
    ).rejects.toThrow('invalid request');
    expect(operation).toHaveBeenCalledOnce();
  });
});
