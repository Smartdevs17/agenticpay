import { describe, expect, it, vi, afterEach } from 'vitest';
import { JobScheduler } from '../scheduler.js';
import type { JobDefinition } from '../types.js';

describe('JobScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs one-time jobs and updates status', async () => {
    vi.useFakeTimers();
    const now = new Date('2024-01-01T00:00:00Z');
    vi.setSystemTime(now);

    const scheduler = new JobScheduler();
    const handler = vi.fn();
    const job: JobDefinition = {
      id: 'one-time-success',
      name: 'One time success',
      schedule: { type: 'once', runAt: new Date(now.getTime() + 1000) },
      handler,
    };

    scheduler.addJob(job);

    await vi.runAllTimersAsync();

    const status = scheduler.getStatuses().find((entry) => entry.id === job.id);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(status?.lastSuccessAt).not.toBeNull();
    expect(status?.failureCount).toBe(0);
  });

  it('tracks failures for one-time jobs', async () => {
    vi.useFakeTimers();
    const now = new Date('2024-01-01T00:00:00Z');
    vi.setSystemTime(now);

    const scheduler = new JobScheduler();
    const job: JobDefinition = {
      id: 'one-time-failure',
      name: 'One time failure',
      schedule: { type: 'once', runAt: new Date(now.getTime() + 1000) },
      handler: () => {
        throw new Error('Boom');
      },
    };

    scheduler.addJob(job);

    await vi.runAllTimersAsync();

    const status = scheduler.getStatuses().find((entry) => entry.id === job.id);
    expect(status?.status).toBe('failed');
    expect(status?.failureCount).toBe(1);
    expect(status?.lastError).toBe('Boom');
  });
});
