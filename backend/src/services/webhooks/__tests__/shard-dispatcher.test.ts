import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_SHARD_DISPATCHER_OPTIONS,
  ShardedDispatcher,
  UNPARSEABLE_URL_SHARD,
  readShardDispatcherOptions,
  shardKeyForUrl,
} from '../shard-dispatcher.js';

interface Job {
  id: string;
  host: string;
  dueAt: number;
}

/** A deliver() whose calls stay pending until released, per job id. */
function controllableDeliver() {
  const pending = new Map<string, () => void>();
  const started: string[] = [];
  const deliver = vi.fn(
    (job: Job) =>
      new Promise<void>((resolve) => {
        started.push(job.id);
        pending.set(job.id, resolve);
      }),
  );
  const release = async (id: string) => {
    pending.get(id)?.();
    pending.delete(id);
    // Let the shard loop advance to its next item.
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { deliver, started, release, pending };
}

function dispatcherFor(
  deliver: (job: Job) => Promise<void>,
  options = DEFAULT_SHARD_DISPATCHER_OPTIONS,
  extra: { now?: () => number; logger?: { warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void } } = {},
) {
  return new ShardedDispatcher<Job>(options, {
    shardKey: (job) => job.host,
    dueAt: (job) => job.dueAt,
    deliver,
    ...extra,
  });
}

const job = (id: string, host: string, dueAt = 0): Job => ({ id, host, dueAt });

describe('shardKeyForUrl', () => {
  it('shards by lowercased host, ignoring scheme, port, path and a trailing dot', () => {
    expect(shardKeyForUrl('https://API.Example.com/hooks')).toBe('api.example.com');
    expect(shardKeyForUrl('https://api.example.com:8443/x')).toBe('api.example.com');
    expect(shardKeyForUrl('http://api.example.com./x')).toBe('api.example.com');
  });

  it('keeps different hosts, including subdomains, on different shards', () => {
    expect(shardKeyForUrl('https://a.example.com/')).not.toBe(shardKeyForUrl('https://b.example.com/'));
  });

  it('strips IPv6 brackets', () => {
    expect(shardKeyForUrl('https://[2001:db8::1]:9000/hook')).toBe('2001:db8::1');
  });

  it('puts unparseable URLs on a dedicated shard', () => {
    expect(shardKeyForUrl('not a url')).toBe(UNPARSEABLE_URL_SHARD);
  });
});

describe('readShardDispatcherOptions', () => {
  it('uses the defaults when unset or blank', () => {
    expect(readShardDispatcherOptions({})).toEqual(DEFAULT_SHARD_DISPATCHER_OPTIONS);
    expect(
      readShardDispatcherOptions({ WEBHOOK_DISPATCH_MAX_CONCURRENT_SHARDS: ' ', WEBHOOK_DISPATCH_MAX_BATCH_PER_SHARD: '' }),
    ).toEqual(DEFAULT_SHARD_DISPATCHER_OPTIONS);
  });

  it('reads valid overrides', () => {
    expect(
      readShardDispatcherOptions({ WEBHOOK_DISPATCH_MAX_CONCURRENT_SHARDS: '32', WEBHOOK_DISPATCH_MAX_BATCH_PER_SHARD: '5' }),
    ).toEqual({ maxConcurrentShards: 32, maxBatchPerShard: 5 });
  });

  it.each(['0', '-1', '1.5', 'eight', '257'])('rejects WEBHOOK_DISPATCH_MAX_CONCURRENT_SHARDS=%s', (value) => {
    expect(() => readShardDispatcherOptions({ WEBHOOK_DISPATCH_MAX_CONCURRENT_SHARDS: value })).toThrow(
      /WEBHOOK_DISPATCH_MAX_CONCURRENT_SHARDS must be an integer between 1 and 256/,
    );
  });

  it('rejects an out-of-range batch size', () => {
    expect(() => readShardDispatcherOptions({ WEBHOOK_DISPATCH_MAX_BATCH_PER_SHARD: '1001' })).toThrow(
      /WEBHOOK_DISPATCH_MAX_BATCH_PER_SHARD/,
    );
  });
});

describe('ShardedDispatcher', () => {
  it('a slow host does not delay deliveries to other hosts', async () => {
    const { deliver, started, release } = controllableDeliver();
    const dispatcher = dispatcherFor(deliver);

    dispatcher.dispatch([job('slow-1', 'slow.example'), job('fast-1', 'fast.example'), job('fast-2', 'fast.example')]);

    // Both hosts start immediately; the slow one is still pending.
    expect(started).toEqual(['slow-1', 'fast-1']);
    await release('fast-1');
    expect(started).toEqual(['slow-1', 'fast-1', 'fast-2']);
    await release('fast-2');
    expect(dispatcher.activeShards()).toEqual(['slow.example']);

    await release('slow-1');
    await dispatcher.idle();
    expect(dispatcher.activeShards()).toEqual([]);
  });

  it('sends at most one request at a time to a host, oldest first', async () => {
    const { deliver, started, release } = controllableDeliver();
    const dispatcher = dispatcherFor(deliver);

    dispatcher.dispatch([job('c', 'h.example', 30), job('a', 'h.example', 10), job('b', 'h.example', 20)]);
    expect(started).toEqual(['a']);
    await release('a');
    expect(started).toEqual(['a', 'b']);
    await release('b');
    await release('c');
    expect(started).toEqual(['a', 'b', 'c']);
  });

  it('skips a host that is still draining instead of sending its deliveries twice', async () => {
    const { deliver, started, release } = controllableDeliver();
    const dispatcher = dispatcherFor(deliver);
    const items = [job('x1', 'h.example')];

    const first = dispatcher.dispatch(items);
    const second = dispatcher.dispatch(items);

    expect(first).toMatchObject({ started: 1, busy: 0 });
    expect(second).toMatchObject({ started: 0, busy: 1 });
    expect(deliver).toHaveBeenCalledTimes(1);
    await release('x1');
    await first.settled;
    expect(dispatcher.stats().busyShardSkips).toBe(1);
  });

  it('caps concurrently draining hosts and starts the oldest-waiting hosts first', async () => {
    const { deliver, started, release } = controllableDeliver();
    const dispatcher = dispatcherFor(deliver, { maxConcurrentShards: 2, maxBatchPerShard: 25 });

    const pass = dispatcher.dispatch([
      job('new', 'new.example', 300),
      job('old', 'old.example', 100),
      job('mid', 'mid.example', 200),
    ]);

    expect(pass).toMatchObject({ shards: 3, started: 2, deferred: 1 });
    expect(started).toEqual(['old', 'mid']);

    await release('old');
    const next = dispatcher.dispatch([job('new', 'new.example', 300)]);
    expect(next.started).toBe(1);
    expect(started).toContain('new');
    await release('mid');
    await release('new');
    await dispatcher.idle();
  });

  it('drains at most maxBatchPerShard deliveries per run, leaving the rest for a later pass', async () => {
    const deliver = vi.fn(async () => {});
    const dispatcher = dispatcherFor(deliver, { maxConcurrentShards: 8, maxBatchPerShard: 2 });

    const pass = dispatcher.dispatch([job('1', 'h', 1), job('2', 'h', 2), job('3', 'h', 3)]);
    await pass.settled;

    expect(deliver.mock.calls.map(([j]) => (j as Job).id)).toEqual(['1', '2']);
  });

  it('keeps draining a host after one delivery throws, and logs it', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const deliver = vi.fn(async (j: Job) => {
      if (j.id === 'bad') throw new Error('boom');
    });
    const dispatcher = dispatcherFor(deliver, DEFAULT_SHARD_DISPATCHER_OPTIONS, { logger });

    await dispatcher.dispatch([job('bad', 'h', 1), job('good', 'h', 2)]).settled;

    expect(deliver).toHaveBeenCalledTimes(2);
    expect(dispatcher.activeShards()).toEqual([]);
    expect(dispatcher.stats().deliverErrors).toBe(1);
    expect(logger.error).toHaveBeenCalledWith('webhook shard delivery threw', { shard: 'h', error: 'boom' });
  });

  it('records queue wait from the due time and shard run time', async () => {
    let now = 1_000;
    const deliver = vi.fn(async () => {
      now += 50;
    });
    const dispatcher = dispatcherFor(deliver, DEFAULT_SHARD_DISPATCHER_OPTIONS, { now: () => now });

    await dispatcher.dispatch([job('a', 'h', 400), job('b', 'h', 900)]).settled;

    const stats = dispatcher.stats();
    // a waited 1000-400=600ms; b started after a's 50ms send: 1050-900=150ms.
    expect(stats.queueWaitMs).toMatchObject({ samples: 2, max: 600, p50: 150 });
    expect(stats.shardRunMs).toMatchObject({ samples: 1, max: 100 });
    expect(stats).toMatchObject({ passes: 1, shardRuns: 1, deliveriesStarted: 2, dueBacklog: 2, activeShards: 0 });
  });

  it('warns once per minute while saturated', async () => {
    let now = 0;
    const logger = { warn: vi.fn(), error: vi.fn() };
    const { deliver, release } = controllableDeliver();
    const dispatcher = dispatcherFor(deliver, { maxConcurrentShards: 1, maxBatchPerShard: 25 }, { logger, now: () => now });

    const items = [job('a', 'a.example', 1), job('b', 'b.example', 2)];
    dispatcher.dispatch(items);
    dispatcher.dispatch(items);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][1]).toMatchObject({ deferredShards: 1, maxConcurrentShards: 1 });

    now += 60_000;
    dispatcher.dispatch(items);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(dispatcher.stats().deferredShards).toBe(3);
    await release('a');
    await dispatcher.idle();
  });

  it('reports an empty pass without starting anything', async () => {
    const deliver = vi.fn(async () => {});
    const dispatcher = dispatcherFor(deliver);
    const pass = dispatcher.dispatch([]);
    await pass.settled;
    expect(pass).toMatchObject({ due: 0, shards: 0, started: 0, busy: 0, deferred: 0 });
    expect(deliver).not.toHaveBeenCalled();
    expect(dispatcher.stats().queueWaitMs).toEqual({ samples: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });
});
