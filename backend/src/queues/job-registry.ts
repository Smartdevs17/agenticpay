/**
 * Issue #488 — Declarative BullMQ Job Registry
 *
 * Single source of truth for all BullMQ queue job definitions with
 * consistent retry policies, metrics collection, and standardised error handling.
 */

import { Queue, Worker, type Job } from 'bullmq';
import type { QueueJobDefinition, JobMetrics } from './types.js';

export class BullMQJobRegistry {
  private definitions = new Map<string, QueueJobDefinition>();
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();
  private metrics = new Map<string, JobMetrics>();

  constructor(private readonly redisConnection: { host: string; port: number }) {}

  /** Register a job definition. Must be called before start(). */
  register<TData>(definition: QueueJobDefinition<TData>): void {
    if (this.definitions.has(definition.name)) {
      throw new Error(`Job "${definition.name}" is already registered`);
    }
    this.definitions.set(definition.name, definition as QueueJobDefinition);
    this.metrics.set(definition.name, { completed: 0, failed: 0, active: 0, waiting: 0, delayed: 0 });
  }

  /** Start workers for all registered jobs. */
  start(): void {
    for (const def of Array.from(this.definitions.values())) {
      if (!this.queues.has(def.queue)) {
        this.queues.set(def.queue, new Queue(def.queue, { connection: this.redisConnection }));
      }

      const worker = new Worker(
        def.queue,
        async (job: Job) => {
          if (job.name !== def.name) return; // each worker handles its own job type
          const m = this.metrics.get(def.name)!;
          m.active++;
          try {
            await def.handler(job.data);
            m.completed++;
          } catch (err) {
            m.failed++;
            throw err; // BullMQ handles retry/DLQ
          } finally {
            m.active = Math.max(0, m.active - 1);
          }
        },
        {
          connection: this.redisConnection,
          concurrency: def.concurrency,
          limiter: undefined,
        },
      );

      this.workers.set(def.name, worker);
    }
  }

  /** Enqueue a job by name. */
  async enqueue<TData>(name: string, data: TData): Promise<void> {
    const def = this.definitions.get(name);
    if (!def) throw new Error(`Unknown job: ${name}`);

    const queue = this.queues.get(def.queue);
    if (!queue) throw new Error(`Queue "${def.queue}" not started — call start() first`);

    await queue.add(name, data, {
      attempts: def.retry.maxAttempts,
      backoff: { type: 'exponential', delay: def.retry.backoff.delay },
      ...(def.timeoutMs ? { timeout: def.timeoutMs } : {}),
      ...(def.retry.deadLetterQueue
        ? { deadLetterExchange: def.retry.deadLetterQueue }
        : {}),
    });
  }

  /** Returns snapshot metrics for all registered jobs. */
  getMetrics(): Record<string, JobMetrics> {
    return Object.fromEntries(this.metrics.entries());
  }

  /** Returns definitions for all registered jobs (admin view). */
  listJobs(): Array<Omit<QueueJobDefinition, 'handler'>> {
    return Array.from(this.definitions.values()).map(({ handler: _h, ...rest }) => rest);
  }

  /** Gracefully close all workers and queues. */
  async close(): Promise<void> {
    await Promise.all([
      ...Array.from(this.workers.values()).map((w) => w.close()),
      ...Array.from(this.queues.values()).map((q) => q.close()),
    ]);
  }
}
