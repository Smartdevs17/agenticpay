/**
 * Distributed job scheduler backed by BullMQ + Redis.
 *
 * When Redis is available (REDIS_ENABLED=true + REDIS_URL) this replaces the
 * in-process node-cron scheduler with a durable, distributed queue that:
 *   - Survives process restarts (jobs are persisted in Redis)
 *   - Guarantees at-least-once delivery
 *   - Retries with exponential back-off
 *   - Exposes a monitoring API (queued / active / completed / failed counts)
 *   - Scales horizontally — multiple worker processes can share the load
 *
 * When Redis is unavailable the factory returns null and the caller falls
 * back to the in-process node-cron scheduler.
 */

import { Queue, Worker, QueueEvents, type Job, type ConnectionOptions } from 'bullmq';
import type { ScheduledTaskMeta } from '../config/scheduled-tasks.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BullMQSchedulerOptions {
  redisUrl: string;
  /** Prefix for all BullMQ queue names (default: "agenticpay") */
  prefix?: string;
}

export interface QueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface JobQueueStatus {
  id: string;
  name: string;
  queueName: string;
  metrics: QueueMetrics;
  nextScheduledRun: string | null;
}

// ---------------------------------------------------------------------------
// BullMQScheduler
// ---------------------------------------------------------------------------

export class BullMQScheduler {
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();
  private queueEvents = new Map<string, QueueEvents>();
  private connection: ConnectionOptions;
  private prefix: string;

  constructor(opts: BullMQSchedulerOptions) {
    this.prefix = opts.prefix ?? 'agenticpay';
    this.connection = this.parseRedisUrl(opts.redisUrl);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Register a scheduled task as a repeating BullMQ job.
   * Uses BullMQ's native cron repeat support so schedules survive restarts.
   */
  async addTask(task: ScheduledTaskMeta): Promise<void> {
    const queueName = `${this.prefix}:${task.id}`;

    const queue = new Queue(queueName, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });

    // Remove any stale repeatable jobs before registering the current schedule
    const repeatable = await queue.getRepeatableJobs();
    for (const job of repeatable) {
      await queue.removeRepeatableByKey(job.key);
    }

    // Register the repeating cron job
    await queue.add(
      task.name,
      { taskId: task.id },
      {
        repeat: {
          pattern: task.schedule,
          tz: task.timezone ?? 'UTC',
        },
        jobId: `repeat:${task.id}`,
      },
    );

    const worker = new Worker(
      queueName,
      async (job: Job) => {
        const timeoutMs = task.timeoutMs;
        if (timeoutMs) {
          await Promise.race([
            Promise.resolve(task.handler()),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`[${task.id}] Timed out after ${timeoutMs}ms`)), timeoutMs),
            ),
          ]);
        } else {
          await Promise.resolve(task.handler());
        }
      },
      {
        connection: this.connection,
        concurrency: 1,
      },
    );

    worker.on('completed', (job) => {
      console.log(`[bullmq] ${task.id} completed (job ${job.id})`);
    });

    worker.on('failed', (job, err) => {
      console.error(`[bullmq] ${task.id} failed (job ${job?.id}):`, err.message);
    });

    const events = new QueueEvents(queueName, { connection: this.connection });

    this.queues.set(task.id, queue);
    this.workers.set(task.id, worker);
    this.queueEvents.set(task.id, events);
  }

  /**
   * Gracefully shut down all workers and close queue connections.
   * Waits for in-flight jobs to complete before closing.
   */
  async shutdown(): Promise<void> {
    console.log('[bullmq] Shutting down workers…');

    await Promise.all(
      Array.from(this.workers.values()).map((w) => w.close()),
    );

    await Promise.all(
      Array.from(this.queueEvents.values()).map((e) => e.close()),
    );

    await Promise.all(
      Array.from(this.queues.values()).map((q) => q.close()),
    );

    this.workers.clear();
    this.queueEvents.clear();
    this.queues.clear();

    console.log('[bullmq] All workers stopped');
  }

  /**
   * Trigger a task to run immediately (outside its schedule).
   */
  async runTaskNow(taskId: string): Promise<void> {
    const queue = this.queues.get(taskId);
    if (!queue) {
      throw new Error(`No BullMQ queue found for task "${taskId}"`);
    }
    await queue.add(`manual:${taskId}`, { taskId, manual: true }, { jobId: `manual:${taskId}:${Date.now()}` });
  }

  /**
   * Pause the repeating schedule for a task.
   */
  async pauseTask(taskId: string): Promise<void> {
    await this.queues.get(taskId)?.pause();
  }

  /**
   * Resume a paused task queue.
   */
  async resumeTask(taskId: string): Promise<void> {
    await this.queues.get(taskId)?.resume();
  }

  // ── Monitoring ────────────────────────────────────────────────────────────

  /**
   * Return queue depth metrics for all registered tasks.
   */
  async getMetrics(): Promise<JobQueueStatus[]> {
    const results: JobQueueStatus[] = [];

    for (const [taskId, queue] of this.queues.entries()) {
      const [waiting, active, completed, failed, delayed, paused, repeatable] =
        await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
          queue.getPausedCount(),
          queue.getRepeatableJobs(),
        ]);

      const nextJob = repeatable[0];

      results.push({
        id: taskId,
        name: queue.name,
        queueName: queue.name,
        metrics: { waiting, active, completed, failed, delayed, paused },
        nextScheduledRun: nextJob?.next ? new Date(nextJob.next).toISOString() : null,
      });
    }

    return results;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private parseRedisUrl(url: string): ConnectionOptions {
    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname || 'localhost',
        port: parseInt(parsed.port || '6379', 10),
        password: parsed.password || undefined,
        username: parsed.username || undefined,
        tls: parsed.protocol === 'rediss:' ? {} : undefined,
      };
    } catch {
      // Fallback for plain "host:port" strings
      const [host, port] = url.split(':');
      return { host: host || 'localhost', port: parseInt(port || '6379', 10) };
    }
  }
}

// ---------------------------------------------------------------------------
// Factory — returns null when Redis is not configured
// ---------------------------------------------------------------------------

let _instance: BullMQScheduler | null = null;

export async function createBullMQScheduler(
  tasks: ScheduledTaskMeta[],
): Promise<BullMQScheduler | null> {
  const redisEnabled = process.env.REDIS_ENABLED === 'true';
  const redisUrl = process.env.REDIS_URL;

  if (!redisEnabled || !redisUrl) {
    return null;
  }

  if (_instance) return _instance;

  const scheduler = new BullMQScheduler({ redisUrl });

  for (const task of tasks) {
    try {
      await scheduler.addTask(task);
    } catch (err) {
      console.error(`[bullmq] Failed to register task "${task.id}":`, err);
    }
  }

  _instance = scheduler;
  console.log(`[bullmq] Distributed scheduler started with ${tasks.length} tasks`);
  return scheduler;
}

export function getBullMQScheduler(): BullMQScheduler | null {
  return _instance;
}
