import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BullMQJobRegistry } from '../job-registry.js';
import type { QueueJobDefinition } from '../types.js';

// Mock BullMQ entirely — no real Redis needed in unit tests
vi.mock('bullmq', () => {
  const Queue = vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }));
  const Worker = vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
  }));
  return { Queue, Worker };
});

const redisConn = { host: 'localhost', port: 6379 };

function makeJob(name = 'test-job'): QueueJobDefinition<{ id: string }> {
  return {
    name,
    queue: 'test-queue',
    concurrency: 2,
    retry: { maxAttempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    timeoutMs: 5000,
    handler: vi.fn().mockResolvedValue(undefined),
  };
}

describe('BullMQJobRegistry', () => {
  let reg: BullMQJobRegistry;

  beforeEach(() => {
    reg = new BullMQJobRegistry(redisConn);
  });

  it('registers a job definition', () => {
    reg.register(makeJob());
    expect(reg.listJobs()).toHaveLength(1);
    expect(reg.listJobs()[0].name).toBe('test-job');
  });

  it('throws on duplicate registration', () => {
    reg.register(makeJob());
    expect(() => reg.register(makeJob())).toThrow('already registered');
  });

  it('handler is not exposed in listJobs', () => {
    reg.register(makeJob());
    const listed = reg.listJobs()[0] as Record<string, unknown>;
    expect(listed.handler).toBeUndefined();
  });

  it('enqueue throws when queue not started', async () => {
    reg.register(makeJob());
    await expect(reg.enqueue('test-job', { id: '1' })).rejects.toThrow('not started');
  });

  it('enqueue throws for unknown job', async () => {
    reg.start();
    await expect(reg.enqueue('unknown', {})).rejects.toThrow('Unknown job');
  });

  it('metrics initialised to zero', () => {
    reg.register(makeJob());
    const metrics = reg.getMetrics();
    expect(metrics['test-job']).toEqual({ completed: 0, failed: 0, active: 0, waiting: 0, delayed: 0 });
  });

  it('starts workers for all registered jobs', () => {
    reg.register(makeJob('job-a'));
    reg.register(makeJob('job-b'));
    expect(() => reg.start()).not.toThrow();
  });
});
