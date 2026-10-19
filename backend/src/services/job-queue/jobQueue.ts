/**
 * jobQueue.ts — Issue #952: Background job queue with retries
 *
 * A small, dependency-free background job queue. It is driven by the caller
 * (`drain()` is invoked by a timer, a request handler, or a test) which keeps
 * the retry/back-off behaviour fully deterministic and lets the same code run
 * on top of an in-memory store today and a durable transport later.
 *
 * Guarantees:
 *   - At-least-once execution: a job is only marked `completed` after its
 *     handler resolves.
 *   - Bounded retries: failures are rescheduled with exponential back-off until
 *     `maxAttempts` is exhausted, after which the job moves to the DLQ.
 *   - No silent loss: every terminal failure is recorded in the DLQ with the
 *     last error message and is observable through `metrics()` / events.
 */
import { randomUUID } from 'node:crypto';

import { DEFAULT_RETRY_POLICY, canRetry, computeBackoffDelayMs } from './backoff.js';
import type {
  DeadLetterEntry,
  JobContext,
  JobHandler,
  JobQueueEvent,
  JobQueueLogger,
  JobQueueMetrics,
  JobQueueSummary,
  JobRecord,
  JobState,
  RetryPolicy,
} from './types.js';

export interface JobQueueOptions {
  /** Logical name, used in log lines. */
  name?: string;
  /** Overrides for the default retry policy. */
  retry?: Partial<RetryPolicy>;
  logger?: JobQueueLogger;
  /** Injectable clock, defaults to `() => new Date()`. */
  now?: () => Date;
  /** Injectable id generator, defaults to `randomUUID`. */
  idFactory?: () => string;
  /** Injectable RNG for jitter, defaults to `Math.random`. */
  random?: () => number;
  /** Sink for lifecycle events (metrics, audit, webhooks…). */
  onEvent?: (event: JobQueueEvent) => void;
}

export interface DrainOptions {
  /** Reference time; defaults to the queue clock. */
  now?: Date;
  /** Upper bound on jobs considered in a single pass. Defaults to Infinity. */
  maxJobs?: number;
}

export interface JobFilter {
  state?: JobState;
  name?: string;
}

const consoleLogger: JobQueueLogger = {
  info: (message, meta) => console.info(`[job-queue] ${message}`, meta ?? ''),
  warn: (message, meta) => console.warn(`[job-queue] ${message}`, meta ?? ''),
  error: (message, meta) => console.error(`[job-queue] ${message}`, meta ?? ''),
};

export class JobQueue {
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private readonly jobs = new Map<string, JobRecord>();
  private readonly deadLetters: DeadLetterEntry[] = [];
  private readonly retry: RetryPolicy;
  private readonly logger: JobQueueLogger;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly random: () => number;
  private readonly onEvent?: (event: JobQueueEvent) => void;

  private totalEnqueued = 0;
  private totalCompleted = 0;
  private totalFailedAttempts = 0;
  private totalDeadLettered = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(options: JobQueueOptions = {}) {
    this.retry = { ...DEFAULT_RETRY_POLICY, ...options.retry };
    this.logger = options.logger ?? consoleLogger;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => randomUUID());
    this.random = options.random ?? Math.random;
    this.onEvent = options.onEvent;
  }

  /** Register (or replace) the handler for a job name. */
  registerHandler<TPayload>(name: string, handler: JobHandler<TPayload>): void {
    if (!name) {
      throw new Error('Job name is required');
    }
    this.handlers.set(name, handler as unknown as JobHandler<unknown>);
  }

  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  /** Enqueue a job for asynchronous processing. */
  enqueue<TPayload>(name: string, payload: TPayload): JobRecord<TPayload> {
    if (!this.handlers.has(name)) {
      throw new Error(`Unknown job: ${name}`);
    }

    const timestamp = this.now().toISOString();
    const record: JobRecord<TPayload> = {
      id: this.idFactory(),
      name,
      payload,
      state: 'pending',
      attempts: 0,
      maxAttempts: this.retry.maxAttempts,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
      lastError: null,
      nextAttemptAt: null,
    };

    this.jobs.set(record.id, record as JobRecord);
    this.totalEnqueued += 1;
    this.emit({
      type: 'job.enqueued',
      jobId: record.id,
      name,
      attempt: 0,
      occurredAt: timestamp,
    });
    return record;
  }

  getJob(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  listJobs(filter: JobFilter = {}): JobRecord[] {
    return Array.from(this.jobs.values())
      .filter((job) => (filter.state ? job.state === filter.state : true))
      .filter((job) => (filter.name ? job.name === filter.name : true))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  /** Snapshot of the dead-letter queue. */
  getDeadLetters(): DeadLetterEntry[] {
    return this.deadLetters.map((entry) => ({ ...entry, job: { ...entry.job } }));
  }

  /**
   * Move a dead-lettered job back to `pending` so it can be processed again.
   * Resets the attempt counter.
   */
  requeueDeadLetter(jobId: string): JobRecord | null {
    const index = this.deadLetters.findIndex((entry) => entry.job.id === jobId);
    if (index === -1) {
      return null;
    }
    const [entry] = this.deadLetters.splice(index, 1);
    const job = this.jobs.get(jobId);
    if (!job || !entry) {
      return null;
    }
    job.state = 'pending';
    job.attempts = 0;
    job.nextAttemptAt = null;
    job.lastError = null;
    job.finishedAt = null;
    job.updatedAt = this.now().toISOString();
    this.emit({
      type: 'job.enqueued',
      jobId: job.id,
      name: job.name,
      attempt: 0,
      occurredAt: job.updatedAt,
    });
    return job;
  }

  metrics(): JobQueueMetrics {
    let pending = 0;
    let processing = 0;
    let completed = 0;
    let dead = 0;
    for (const job of this.jobs.values()) {
      if (job.state === 'pending') pending += 1;
      else if (job.state === 'processing') processing += 1;
      else if (job.state === 'completed') completed += 1;
      else if (job.state === 'dead') dead += 1;
    }
    return {
      pending,
      processing,
      completed,
      dead,
      failed: this.totalFailedAttempts,
      totalEnqueued: this.totalEnqueued,
      totalCompleted: this.totalCompleted,
      totalDeadLettered: this.totalDeadLettered,
    };
  }

  /**
   * Process every job whose next attempt is due, up to `maxJobs`.
   *
   * A job that fails and is rescheduled within the same pass is not retried
   * again until the next `drain()` call, which prevents tight retry loops.
   */
  async drain(options: DrainOptions = {}): Promise<JobQueueSummary> {
    const now = options.now ?? this.now();
    const maxJobs = options.maxJobs ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();

    let processed = 0;
    let completed = 0;
    let retried = 0;
    let deadLettered = 0;

    while (processed < maxJobs) {
      const job = this.nextEligible(now, seen);
      if (!job) {
        break;
      }
      seen.add(job.id);

      await this.runAttempt(job, now);
      processed += 1;
      if (job.state === 'completed') completed += 1;
      else if (job.state === 'dead') deadLettered += 1;
      else retried += 1;
    }

    return { processed, completed, retried, deadLettered };
  }

  /** Run a single due job. Returns false when nothing was eligible. */
  async processNext(now: Date = this.now()): Promise<boolean> {
    const job = this.nextEligible(now, new Set());
    if (!job) {
      return false;
    }
    await this.runAttempt(job, now);
    return true;
  }

  /** Start a polling loop that drains the queue every `intervalMs`. */
  start(intervalMs = 1_000): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.drain().catch((error) => {
        this.logger.error('drain failed', { error: (error as Error).message });
      });
    }, intervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private nextEligible(now: Date, exclude: Set<string>): JobRecord | undefined {
    for (const job of this.jobs.values()) {
      if (job.state !== 'pending' || exclude.has(job.id)) {
        continue;
      }
      if (!job.nextAttemptAt || new Date(job.nextAttemptAt).getTime() <= now.getTime()) {
        return job;
      }
    }
    return undefined;
  }

  private async runAttempt(job: JobRecord, now: Date): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      this.deadLetter(job, now, `No handler registered for "${job.name}"`);
      return;
    }

    const attempt = job.attempts + 1;
    job.state = 'processing';
    job.attempts = attempt;
    job.startedAt = this.now().toISOString();
    job.updatedAt = job.startedAt;
    this.emit({ type: 'job.started', jobId: job.id, name: job.name, attempt, occurredAt: job.updatedAt });

    const context: JobContext = { jobId: job.id, name: job.name, attempt };

    try {
      await handler(job.payload, context);
      job.state = 'completed';
      job.finishedAt = this.now().toISOString();
      job.updatedAt = job.finishedAt;
      job.lastError = null;
      job.nextAttemptAt = null;
      this.totalCompleted += 1;
      this.emit({
        type: 'job.completed',
        jobId: job.id,
        name: job.name,
        attempt,
        occurredAt: job.updatedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.totalFailedAttempts += 1;
      job.lastError = message;
      job.updatedAt = this.now().toISOString();
      this.emit({
        type: 'job.failed',
        jobId: job.id,
        name: job.name,
        attempt,
        occurredAt: job.updatedAt,
        error: message,
      });
      this.logger.warn('job attempt failed', { jobId: job.id, name: job.name, attempt, error: message });

      if (canRetry(job.attempts, this.retry)) {
        const delay = computeBackoffDelayMs(job.attempts, this.retry, this.random);
        job.state = 'pending';
        job.nextAttemptAt = new Date(now.getTime() + delay).toISOString();
        this.emit({
          type: 'job.retrying',
          jobId: job.id,
          name: job.name,
          attempt,
          occurredAt: job.updatedAt,
          error: message,
        });
      } else {
        this.deadLetter(job, now, message);
      }
    }
  }

  private deadLetter(job: JobRecord, now: Date, reason: string): void {
    job.state = 'dead';
    job.lastError = reason;
    job.finishedAt = this.now().toISOString();
    job.updatedAt = job.finishedAt;
    job.nextAttemptAt = null;
    this.totalDeadLettered += 1;
    this.deadLetters.push({ job: { ...job }, failedAt: now.toISOString(), reason });
    this.emit({
      type: 'job.dead_lettered',
      jobId: job.id,
      name: job.name,
      attempt: job.attempts,
      occurredAt: job.updatedAt,
      error: reason,
    });
    this.logger.error('job moved to dead-letter queue', {
      jobId: job.id,
      name: job.name,
      attempts: job.attempts,
      reason,
    });
  }

  private emit(event: JobQueueEvent): void {
    this.onEvent?.(event);
  }
}
