/**
 * index.ts — Issue #952: Background job queue with retries
 *
 * Public surface of the background job queue domain. Import `jobQueue` (the
 * shared instance) in application wiring and register handlers with
 * `jobQueue.registerHandler('name', fn)` before enqueuing that job.
 */
export * from './types.js';
export { DEFAULT_RETRY_POLICY, computeBackoffDelayMs, canRetry } from './backoff.js';
export {
  JobQueue,
  type JobQueueOptions,
  type DrainOptions,
  type JobFilter,
} from './jobQueue.js';

import { JobQueue } from './jobQueue.js';

/** Shared queue instance used by the HTTP admin surface and workers. */
export const jobQueue = new JobQueue({ name: 'default' });
