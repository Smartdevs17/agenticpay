import { describe, it, expect } from 'vitest';
import { PayoutBatcher } from '../payout-batcher.js';
import {
  PayoutIdempotencyStore,
  fingerprintPayoutRequest,
} from '../payout-idempotency.js';

describe('PayoutIdempotencyStore (#1005)', () => {
  it('returns the original value for a replayed key', () => {
    const store = new PayoutIdempotencyStore<string>();
    const fingerprint = 'fp-1';
    expect(store.lookup('k', fingerprint)).toEqual({ status: 'miss' });
    store.save('k', fingerprint, 'original');
    expect(store.lookup('k', fingerprint)).toEqual({ status: 'replay', value: 'original' });
  });

  it('flags a key reused with a different fingerprint', () => {
    const store = new PayoutIdempotencyStore<string>();
    store.save('k', 'fp-1', 'original');
    expect(store.lookup('k', 'fp-2')).toEqual({ status: 'mismatch' });
  });

  it('expires keys after the TTL and purges them', () => {
    let now = 1_000;
    const store = new PayoutIdempotencyStore<string>(500, 100, () => now);
    store.save('k', 'fp', 'value');
    now += 501;
    expect(store.lookup('k', 'fp')).toEqual({ status: 'miss' });
    store.save('expired', 'fp', 'value');
    now += 501;
    expect(store.purgeExpired()).toBe(1);
  });

  it('bounds the number of remembered keys', () => {
    const store = new PayoutIdempotencyStore<number>(10_000, 2);
    store.save('a', 'fp', 1);
    store.save('b', 'fp', 2);
    store.save('c', 'fp', 3);
    expect(store.size()).toBe(2);
    expect(store.lookup('a', 'fp')).toEqual({ status: 'miss' });
  });

  it('fingerprints are stable across object key ordering', () => {
    expect(fingerprintPayoutRequest({ a: 1, b: 2 })).toBe(fingerprintPayoutRequest({ b: 2, a: 1 }));
  });
});

describe('PayoutBatcher idempotency (#1005)', () => {
  const baseInput = {
    merchantId: 'merch_1',
    recipient: 'acct_1',
    amount: 250,
    asset: 'USDC',
  } as const;

  it('returns the original payout when a key is replayed', () => {
    const batcher = new PayoutBatcher();
    const first = batcher.schedule({ ...baseInput, idempotencyKey: 'idem-1' });
    const second = batcher.schedule({ ...baseInput, idempotencyKey: 'idem-1' });

    expect(second.id).toBe(first.id);
    expect(batcher.listPayouts()).toHaveLength(1);
  });

  it('rejects a key reused with a different body', () => {
    const batcher = new PayoutBatcher();
    batcher.schedule({ ...baseInput, idempotencyKey: 'idem-2' });

    expect(() =>
      batcher.schedule({ ...baseInput, amount: 999, idempotencyKey: 'idem-2' }),
    ).toThrow('IDEMPOTENCY_KEY_REUSE_MISMATCH');
  });

  it('treats different keys as different payouts', () => {
    const batcher = new PayoutBatcher();
    const first = batcher.schedule({ ...baseInput, idempotencyKey: 'idem-3a' });
    const second = batcher.schedule({ ...baseInput, idempotencyKey: 'idem-3b' });

    expect(second.id).not.toBe(first.id);
    expect(batcher.listPayouts()).toHaveLength(2);
  });

  it('creates a fresh payout once a key expires', () => {
    let clock = Date.now();
    const batcher = new PayoutBatcher({ idempotencyTtlMs: 1_000, now: () => new Date(clock) });

    const first = batcher.schedule({ ...baseInput, idempotencyKey: 'idem-4' });
    clock += 1_001;
    const second = batcher.schedule({ ...baseInput, idempotencyKey: 'idem-4' });

    expect(second.id).not.toBe(first.id);
    expect(batcher.purgeExpiredIdempotencyKeys()).toBe(1);
  });

  it('does not deduplicate when no key is supplied', () => {
    const batcher = new PayoutBatcher();
    const first = batcher.schedule({ ...baseInput });
    const second = batcher.schedule({ ...baseInput });
    expect(second.id).not.toBe(first.id);
  });
});
