/**
 * jobQueue.test.ts — Issue #952: Background job queue with retries
 *
 * Covers the success path, graceful failure, exponential back-off with
 * configurable limits, dead-letter handling, requeueing, metrics and events.
 */
import { describe, expect, it, vi } from 'vitest';

import { JobQueue, type JobQueueEvent, type RetryPolicy } from './index.js';
import { computeBackoffDelayMs, canRetry, DEFAULT_RETRY_POLICY } from './backoff.js';

const T0 = new Date('2026-09-28T00:00:00.000Z');

const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

function makeQueue(overrides: Partial<RetryPolicy> = {}, clock = { current: T0 }) {
  const events: JobQueueEvent[] = [];
  let counter = 0;
  const queue = new JobQueue({
    retry: { maxAttempts: 3, initialDelayMs: 1_000, maxDelayMs: 10_000, multiplier: 2, jitter: false, ...overrides },
    now: () => clock.current,
    idFactory: () => `job-${++counter}`,
    onEvent: (event) => events.push(event),
    logger: silentLogger,
  });
  return { queue, events, clock };
}

describe('computeBackoffDelayMs', () => {
  it('grows exponentially from the initial delay', () => {
    const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 100_000 };
    expect(computeBackoffDelayMs(1, policy)).toBe(1_000);
    expect(computeBackoffDelayMs(2, policy)).toBe(2_000);
    expect(computeBackoffDelayMs(3, policy)).toBe(4_000);
  });

  it('caps the delay at maxDelayMs', () => {
    const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, initialDelayMs: 1_000, multiplier: 10, maxDelayMs: 5_000 };
    expect(computeBackoffDelayMs(4, policy)).toBe(5_000);
  });

  it('applies full jitter using the injected RNG', () => {
    const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 100_000, jitter: true };
    expect(computeBackoffDelayMs(2, policy, () => 0.5)).toBe(1_000);
    expect(computeBackoffDelayMs(2, policy, () => 0)).toBe(0);
  });

  it('rejects invalid inputs', () => {
    expect(() => computeBackoffDelayMs(0)).toThrow();
    expect(() => computeBackoffDelayMs(1, { ...DEFAULT_RETRY_POLICY, maxAttempts: 0 })).toThrow();
    expect(() => computeBackoffDelayMs(1, { ...DEFAULT_RETRY_POLICY, multiplier: 0 })).toThrow();
  });

  it('reports retry eligibility', () => {
    const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, maxAttempts: 2 };
    expect(canRetry(0, policy)).toBe(true);
    expect(canRetry(1, policy)).toBe(true);
    expect(canRetry(2, policy)).toBe(false);
  });
});

describe('JobQueue registration & enqueue', () => {
  it('runs a registered handler and completes the job', async () => {
    const { queue, events } = makeQueue();
    const handler = vi.fn().mockResolvedValue(undefined);
    queue.registerHandler('send-email', handler);

    const job = queue.enqueue('send-email', { to: 'a@b.c' });
    expect(job.state).toBe('pending');

    const summary = await queue.drain();
    expect(summary).toEqual({ processed: 1, completed: 1, retried: 0, deadLettered: 0 });
    expect(handler).toHaveBeenCalledWith({ to: 'a@b.c' }, { jobId: 'job-1', name: 'send-email', attempt: 1 });

    const stored = queue.getJob('job-1');
    expect(stored?.state).toBe('completed');
    expect(stored?.attempts).toBe(1);

    const types = events.map((event) => event.type);
    expect(types).toEqual(['job.enqueued', 'job.started', 'job.completed']);
  });

  it('rejects enqueuing an unregistered job name', () => {
    const { queue } = makeQueue();
    expect(() => queue.enqueue('nope', {})).toThrow(/Unknown job/);
  });

  it('drains nothing when the queue is empty', async () => {
    const { queue } = makeQueue();
    const summary = await queue.drain();
    expect(summary.processed).toBe(0);
  });
});

describe('JobQueue retries with exponential back-off', () => {
  it('retries a failing job and succeeds on the final attempt', async () => {
    const { queue, events, clock } = makeQueue();
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('flaky 1'))
      .mockRejectedValueOnce(new Error('flaky 2'))
      .mockResolvedValue(undefined);
    queue.registerHandler('flaky', handler);
    queue.enqueue('flaky', {});

    const first = await queue.drain();
    expect(first).toEqual({ processed: 1, completed: 0, retried: 1, deadLettered: 0 });
    expect(queue.getJob('job-1')?.state).toBe('pending');
    expect(queue.getJob('job-1')?.nextAttemptAt).toBe('2026-09-28T00:00:01.000Z');

    // Before the back-off elapses the job is not eligible.
    clock.current = new Date('2026-09-28T00:00:00.500Z');
    expect((await queue.drain()).processed).toBe(0);

    // First retry is due at +1s.
    clock.current = new Date('2026-09-28T00:00:01.000Z');
    expect((await queue.drain()).retried).toBe(1);
    expect(queue.getJob('job-1')?.nextAttemptAt).toBe('2026-09-28T00:00:03.000Z');

    // Second retry is due at +3s and succeeds.
    clock.current = new Date('2026-09-28T00:00:03.000Z');
    const third = await queue.drain();
    expect(third.completed).toBe(1);
    expect(queue.getJob('job-1')?.state).toBe('completed');
    expect(queue.getJob('job-1')?.attempts).toBe(3);
    expect(handler).toHaveBeenCalledTimes(3);

    expect(events.map((event) => event.type)).toContain('job.retrying');
  });

  it('honours a custom back-off limit', async () => {
    const { queue, clock } = makeQueue({ maxAttempts: 5, initialDelayMs: 100, maxDelayMs: 150, multiplier: 3 });
    queue.registerHandler('fail', () => {
      throw new Error('always');
    });
    queue.enqueue('fail', {});

    await queue.drain();
    expect(queue.getJob('job-1')?.nextAttemptAt).toBe('2026-09-28T00:00:00.100Z');

    clock.current = new Date('2026-09-28T00:00:00.100Z');
    await queue.drain();
    // 100 * 3 = 300, capped at 150.
    expect(queue.getJob('job-1')?.nextAttemptAt).toBe('2026-09-28T00:00:00.250Z');
  });
});

describe('JobQueue dead-letter handling', () => {
  it('moves a job to the DLQ once attempts are exhausted', async () => {
    const { queue, events } = makeQueue({ maxAttempts: 2, initialDelayMs: 0 });
    queue.registerHandler('always-fail', () => Promise.reject(new Error('boom')));
    queue.enqueue('always-fail', { id: 7 });

    await queue.drain();
    expect(queue.getJob('job-1')?.state).toBe('pending');

    const second = await queue.drain();
    expect(second.deadLettered).toBe(1);

    const stored = queue.getJob('job-1');
    expect(stored?.state).toBe('dead');
    expect(stored?.attempts).toBe(2);
    expect(stored?.lastError).toBe('boom');

    const dlq = queue.getDeadLetters();
    expect(dlq).toHaveLength(1);
    expect(dlq[0].reason).toBe('boom');
    expect(dlq[0].job.id).toBe('job-1');
    expect(events.map((event) => event.type)).toContain('job.dead_lettered');
  });

  it('dead-letters a job whose handler is missing at run time', async () => {
    const { queue } = makeQueue();
    queue.registerHandler('temp', () => undefined);
    queue.enqueue('temp', {});
    // Simulate the handler being unregistered between enqueue and drain.
    (queue as unknown as { handlers: Map<string, unknown> }).handlers.delete('temp');

    const summary = await queue.drain();
    expect(summary.deadLettered).toBe(1);
    expect(queue.getDeadLetters()[0].reason).toMatch(/No handler/);
  });

  it('requeues a dead-lettered job and processes it again', async () => {
    const { queue } = makeQueue({ maxAttempts: 1 });
    let shouldFail = true;
    queue.registerHandler('switchy', () => {
      if (shouldFail) throw new Error('first time');
    });
    queue.enqueue('switchy', {});

    await queue.drain();
    expect(queue.getJob('job-1')?.state).toBe('dead');

    shouldFail = false;
    const requeued = queue.requeueDeadLetter('job-1');
    expect(requeued?.state).toBe('pending');
    expect(requeued?.attempts).toBe(0);
    expect(queue.getDeadLetters()).toHaveLength(0);

    const summary = await queue.drain();
    expect(summary.completed).toBe(1);
    expect(queue.getJob('job-1')?.state).toBe('completed');
  });

  it('returns null when requeueing an unknown dead letter', () => {
    const { queue } = makeQueue();
    expect(queue.requeueDeadLetter('missing')).toBeNull();
  });
});

describe('JobQueue metrics & listing', () => {
  it('tracks counts across states', async () => {
    const { queue } = makeQueue({ maxAttempts: 1 });
    queue.registerHandler('ok', () => undefined);
    queue.registerHandler('bad', () => Promise.reject(new Error('nope')));

    queue.enqueue('ok', {});
    queue.enqueue('bad', {});
    await queue.drain();

    const metrics = queue.metrics();
    expect(metrics.completed).toBe(1);
    expect(metrics.dead).toBe(1);
    expect(metrics.pending).toBe(0);
    expect(metrics.failed).toBe(1);
    expect(metrics.totalEnqueued).toBe(2);
    expect(metrics.totalCompleted).toBe(1);
    expect(metrics.totalDeadLettered).toBe(1);
  });

  it('filters jobs by state and name', async () => {
    const { queue } = makeQueue();
    queue.registerHandler('a', () => undefined);
    queue.registerHandler('b', () => undefined);
    queue.enqueue('a', {});
    queue.enqueue('b', {});
    await queue.drain();

    expect(queue.listJobs({ state: 'completed' })).toHaveLength(2);
    expect(queue.listJobs({ name: 'a' })).toHaveLength(1);
    expect(queue.listJobs({ name: 'a', state: 'completed' })[0].name).toBe('a');
  });
});
