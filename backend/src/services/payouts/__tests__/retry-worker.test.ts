import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPayoutRetryWorker } from '../retry-worker.js';

describe('startPayoutRetryWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs a retry pass on every interval', async () => {
    vi.useFakeTimers();
    const retryDueBatches = vi.fn(async () => [{ id: 'b1' }]);
    const worker = startPayoutRetryWorker({ retryDueBatches } as never, 1_000);

    await vi.advanceTimersByTimeAsync(3_000);

    expect(retryDueBatches).toHaveBeenCalledTimes(3);
    worker.stop();
  });

  it('stops scheduling passes once stopped', async () => {
    vi.useFakeTimers();
    const retryDueBatches = vi.fn(async () => []);
    const worker = startPayoutRetryWorker({ retryDueBatches } as never, 1_000);

    worker.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(retryDueBatches).not.toHaveBeenCalled();
  });

  it('skips an interval while the previous pass is still running', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const retryDueBatches = vi.fn(
      () => new Promise<never[]>((resolve) => {
        release = () => resolve([]);
      }),
    );
    const worker = startPayoutRetryWorker({ retryDueBatches } as never, 1_000);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(retryDueBatches).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(retryDueBatches).toHaveBeenCalledTimes(2);
    worker.stop();
  });

  it('reports a failed pass and keeps the worker alive for the next one', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retryDueBatches = vi
      .fn<() => Promise<{ id: string }[]>>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }]);
    const worker = startPayoutRetryWorker({ retryDueBatches } as never, 60_000);

    await expect(worker.tick()).resolves.toBe(0);
    await expect(worker.tick()).resolves.toBe(2);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    worker.stop();
  });
});
