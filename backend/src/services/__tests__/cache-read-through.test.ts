import { afterEach, describe, expect, it, vi } from 'vitest';
import { CacheService } from '../cache.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeRedis() {
  return {
    get: vi.fn(async (_key: string): Promise<unknown> => null),
    setEx: vi.fn(async (_key: string, _ttl: number, _value: string) => undefined),
    set: vi.fn(async (_key: string, _value: string) => undefined),
    del: vi.fn(async (_key: string | string[]) => undefined),
    scan: vi.fn(async (_cursor: number, _options: { MATCH: string }) => ({ cursor: 0, keys: [] })),
  };
}

function makeService(redis: ReturnType<typeof makeRedis>) {
  return new CacheService({ warmOnStartup: false }, redis as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CacheService read-through optimization', () => {
  it('returns a loaded value without waiting for the cache write', async () => {
    const redis = makeRedis();
    const write = deferred<void>();
    redis.setEx.mockReturnValue(write.promise);
    const service = makeService(redis);

    await expect(service.get('payment:1', async () => ({ id: 'payment:1' }))).resolves.toEqual({
      id: 'payment:1',
    });
    expect(redis.setEx).toHaveBeenCalledOnce();
    expect(service.getMetrics().sets).toBe(1);

    // Release the detached write so the test leaves no pending promise behind.
    write.resolve();
  });

  it('serves cache hits without invoking the loader', async () => {
    const redis = makeRedis();
    redis.get.mockResolvedValue(JSON.stringify({ status: 'settled' }));
    const service = makeService(redis);
    const loader = vi.fn(async () => ({ status: 'pending' }));

    await expect(service.get('payment:2', loader)).resolves.toEqual({ status: 'settled' });
    expect(loader).not.toHaveBeenCalled();
    expect(service.getMetrics()).toMatchObject({ hits: 1, misses: 0 });
  });

  it('coalesces concurrent misses and performs one source load and cache write', async () => {
    const redis = makeRedis();
    const service = makeService(redis);
    const load = deferred<{ amount: number }>();
    const loader = vi.fn(() => load.promise);

    const first = service.get('payment:3', loader);
    const second = service.get('payment:3', loader);
    await Promise.resolve();
    load.resolve({ amount: 25 });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { amount: 25 },
      { amount: 25 },
    ]);
    expect(loader).toHaveBeenCalledOnce();
    expect(redis.setEx).toHaveBeenCalledOnce();
  });

  it('falls back to the source when Redis read fails', async () => {
    const redis = makeRedis();
    redis.get.mockRejectedValue(new Error('Redis unavailable'));
    const service = makeService(redis);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.get('payment:4', async () => ({ id: 'from-db' }))).resolves.toEqual({
      id: 'from-db',
    });
    expect(service.getMetrics()).toMatchObject({ misses: 1, errors: 1 });
    expect(redis.setEx).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('treats malformed cached JSON as a miss and refreshes the entry', async () => {
    const redis = makeRedis();
    redis.get.mockResolvedValue('{not-json');
    const service = makeService(redis);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.get('payment:5', async () => ({ status: 'fresh' }))).resolves.toEqual({
      status: 'fresh',
    });
    expect(service.getMetrics()).toMatchObject({ misses: 1, errors: 1 });
    expect(redis.setEx).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('propagates loader failures and allows a later retry', async () => {
    const redis = makeRedis();
    const service = makeService(redis);
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ status: 'recovered' });

    await expect(service.get('payment:6', loader)).rejects.toThrow('database unavailable');
    expect(redis.setEx).not.toHaveBeenCalled();
    await expect(service.get('payment:6', loader)).resolves.toEqual({ status: 'recovered' });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(redis.setEx).toHaveBeenCalledOnce();
  });

  it('does not fail the successful load when a cache write rejects', async () => {
    const redis = makeRedis();
    redis.setEx.mockRejectedValue(new Error('Redis write failed'));
    const service = makeService(redis);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.get('payment:7', async () => 'source-value')).resolves.toBe('source-value');
    // Allow the detached set() promise to observe and record its rejected write.
    await Promise.resolve();
    await Promise.resolve();
    expect(service.getMetrics()).toMatchObject({ sets: 1, errors: 1 });
    error.mockRestore();
  });
});
