import { describe, expect, it } from 'vitest';
import {
  InMemoryQuotaStore,
  QuotaError,
  QuotaLedger,
  weekStartUtc,
} from './quotaLedger.js';

/** A clock the test can move between weeks. */
function clock(iso: string) {
  let current = new Date(iso);
  return {
    now: () => new Date(current),
    set: (next: string) => {
      current = new Date(next);
    },
  };
}

function ledger(cap: number, at: string) {
  const time = clock(at);
  const store = new InMemoryQuotaStore();
  const quota = new QuotaLedger({ store, weeklyCap: () => cap, now: time.now });
  return { quota, store, time };
}

describe('weekStartUtc', () => {
  it('starts the week on Monday 00:00 UTC', () => {
    // 2026-02-04 is a Wednesday; its week starts Monday 2026-02-02.
    expect(weekStartUtc(new Date('2026-02-04T15:30:00.000Z')).toISOString()).toBe('2026-02-02T00:00:00.000Z');
  });

  it('puts a Sunday in the week that started the previous Monday', () => {
    // 2026-02-08 is a Sunday.
    expect(weekStartUtc(new Date('2026-02-08T23:59:00.000Z')).toISOString()).toBe('2026-02-02T00:00:00.000Z');
  });

  it('puts Monday 00:00 UTC in the new week', () => {
    expect(weekStartUtc(new Date('2026-02-09T00:00:00.000Z')).toISOString()).toBe('2026-02-09T00:00:00.000Z');
  });
});

describe('QuotaLedger.consume', () => {
  it('applies a consumption and reports what remains', async () => {
    const { quota } = ledger(10, '2026-02-04T12:00:00.000Z');

    const result = await quota.consume('key-1', 3, 'req-1');

    expect(result).toMatchObject({ status: 'applied', usage: { used: 3, remaining: 7, cap: 10 } });
  });

  it('accepts a consumption that reaches the cap exactly', async () => {
    const { quota } = ledger(5, '2026-02-04T12:00:00.000Z');
    await quota.consume('key-1', 4, 'a');

    await expect(quota.consume('key-1', 1, 'b')).resolves.toMatchObject({ status: 'applied', usage: { remaining: 0 } });
  });

  it('rejects a consumption over the cap and charges nothing', async () => {
    const { quota } = ledger(5, '2026-02-04T12:00:00.000Z');
    await quota.consume('key-1', 4, 'a');

    const result = await quota.consume('key-1', 2, 'b');

    expect(result).toMatchObject({ status: 'exceeded', requestedUnits: 2, usage: { used: 4, remaining: 1 } });
    // The rejected request left no charge behind, so a smaller one still fits.
    await expect(quota.consume('key-1', 1, 'c')).resolves.toMatchObject({ status: 'applied', usage: { used: 5 } });
  });

  it('treats a replayed idempotency key as a duplicate and does not charge twice', async () => {
    const { quota } = ledger(10, '2026-02-04T12:00:00.000Z');
    await quota.consume('key-1', 3, 'same-request');

    const replay = await quota.consume('key-1', 3, 'same-request');

    expect(replay).toMatchObject({ status: 'duplicate', usage: { used: 3, remaining: 7 } });
    expect(replay).toHaveProperty('originalAt');
  });

  it('resets usage when a new week starts', async () => {
    const { quota, time } = ledger(5, '2026-02-08T23:00:00.000Z');
    await quota.consume('key-1', 5, 'sunday');
    expect((await quota.consume('key-1', 1, 'sunday-2')).status).toBe('exceeded');

    time.set('2026-02-09T00:30:00.000Z');

    await expect(quota.consume('key-1', 5, 'monday')).resolves.toMatchObject({
      status: 'applied',
      usage: { used: 5, remaining: 0, weekStart: '2026-02-09T00:00:00.000Z' },
    });
  });

  it('keeps keys independent', async () => {
    const { quota } = ledger(2, '2026-02-04T12:00:00.000Z');
    await quota.consume('a', 2, 'a-1');

    await expect(quota.consume('b', 2, 'b-1')).resolves.toMatchObject({ status: 'applied' });
  });

  it('applies a cap change immediately', async () => {
    let cap = 2;
    const store = new InMemoryQuotaStore();
    const quota = new QuotaLedger({
      store,
      weeklyCap: () => cap,
      now: () => new Date('2026-02-04T12:00:00.000Z'),
    });
    await quota.consume('key-1', 2, 'a');
    expect((await quota.consume('key-1', 1, 'b')).status).toBe('exceeded');

    cap = 10;

    await expect(quota.consume('key-1', 1, 'c')).resolves.toMatchObject({ status: 'applied', usage: { cap: 10 } });
  });

  it('never lets concurrent consumptions exceed the cap', async () => {
    const { quota } = ledger(3, '2026-02-04T12:00:00.000Z');

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => quota.consume('key-1', 1, `c-${i}`)),
    );

    expect(results.filter((r) => r.status === 'applied')).toHaveLength(3);
    expect(results.filter((r) => r.status === 'exceeded')).toHaveLength(2);
    expect((await quota.usage('key-1')).used).toBe(3);
  });

  it('rejects invalid units, keys and caps with a QuotaError', async () => {
    const { quota } = ledger(10, '2026-02-04T12:00:00.000Z');

    await expect(quota.consume('k', 0, 'x')).rejects.toMatchObject({ code: 'invalid_units' });
    await expect(quota.consume('k', 1.5, 'x')).rejects.toBeInstanceOf(QuotaError);
    await expect(quota.consume('k', 1, '   ')).rejects.toMatchObject({ code: 'invalid_idempotency_key' });

    const broken = new QuotaLedger({ store: new InMemoryQuotaStore(), weeklyCap: () => 0 });
    await expect(broken.consume('k', 1, 'x')).rejects.toMatchObject({ code: 'invalid_cap' });
  });
});

describe('QuotaLedger.usage', () => {
  it('reports usage and the reset time without charging anything', async () => {
    const { quota } = ledger(10, '2026-02-04T12:00:00.000Z');
    await quota.consume('key-1', 4, 'a');

    const usage = await quota.usage('key-1');

    expect(usage).toMatchObject({
      used: 4,
      remaining: 6,
      weekStart: '2026-02-02T00:00:00.000Z',
      resetsAt: '2026-02-09T00:00:00.000Z',
    });
    expect((await quota.usage('key-1')).used).toBe(4);
  });
});
