/**
 * Issue #488 — Declarative BullMQ Job Registry types
 */

export interface RetryPolicy {
  maxAttempts: number;
  backoff: { type: 'exponential'; delay: number };
  deadLetterQueue?: string;
}

export interface JobMetrics {
  completed: number;
  failed: number;
  active: number;
  waiting: number;
  delayed: number;
}

export interface QueueJobDefinition<TData = unknown> {
  /** Unique job name (used as BullMQ job name) */
  name: string;
  /** BullMQ queue name */
  queue: string;
  /** Max concurrent workers for this job */
  concurrency: number;
  /** Retry policy */
  retry: RetryPolicy;
  /** Job timeout in milliseconds */
  timeoutMs: number;
  /** Job handler */
  handler: (data: TData) => Promise<void>;
}
