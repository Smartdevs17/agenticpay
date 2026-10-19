/**
 * types.ts — Issue #952: Background job queue with retries
 *
 * Domain types for a durable background job queue. A job is enqueued with a
 * payload, executed by a registered handler, and — on failure — retried with
 * exponential back-off until it either succeeds or is moved to the
 * dead-letter queue (DLQ).
 */

/** Lifecycle of a queued job. */
export type JobState = 'pending' | 'processing' | 'completed' | 'failed' | 'dead';

/**
 * Retry configuration. `maxAttempts` counts the initial attempt, so a value of
 * 1 means "never retry".
 */
export interface RetryPolicy {
  /** Total attempts, including the first. Must be >= 1. */
  maxAttempts: number;
  /** Delay before the first retry, in milliseconds. */
  initialDelayMs: number;
  /** Upper bound applied after exponential growth, in milliseconds. */
  maxDelayMs: number;
  /** Exponential growth factor applied per consecutive failure. */
  multiplier: number;
  /** When true, apply full jitter to the computed delay. */
  jitter: boolean;
}

/** Context handed to a handler on each attempt. */
export interface JobContext {
  jobId: string;
  name: string;
  /** 1-based attempt number. */
  attempt: number;
}

/** A handler performs the job's work and rejects to signal a failure. */
export type JobHandler<TPayload = unknown> = (
  payload: TPayload,
  context: JobContext,
) => Promise<void> | void;

export interface JobRecord<TPayload = unknown> {
  id: string;
  name: string;
  payload: TPayload;
  state: JobState;
  /** Number of attempts started so far. */
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  /** Error message from the most recent failed attempt. */
  lastError?: string | null;
  /** When the next attempt is eligible to run (ISO-8601), or null. */
  nextAttemptAt?: string | null;
}

export interface DeadLetterEntry<TPayload = unknown> {
  job: JobRecord<TPayload>;
  failedAt: string;
  reason: string;
}

export interface JobQueueMetrics {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  dead: number;
  totalEnqueued: number;
  totalCompleted: number;
  totalDeadLettered: number;
}

export type JobQueueEventType =
  | 'job.enqueued'
  | 'job.started'
  | 'job.completed'
  | 'job.failed'
  | 'job.retrying'
  | 'job.dead_lettered';

export interface JobQueueEvent {
  type: JobQueueEventType;
  jobId: string;
  name: string;
  attempt: number;
  occurredAt: string;
  error?: string;
}

export interface JobQueueSummary {
  /** Jobs with `nextAttemptAt <= now` that were considered. */
  processed: number;
  completed: number;
  retried: number;
  deadLettered: number;
}

/** Minimal logger contract so the queue stays decoupled from a logging lib. */
export interface JobQueueLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
