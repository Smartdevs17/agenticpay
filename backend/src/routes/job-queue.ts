/**
 * job-queue.ts — Issue #952: Background job queue with retries
 *
 * Observability and administration surface for the shared `jobQueue`.
 * Handlers are registered by application wiring; this router only enqueues
 * already-registered jobs and exposes queue state.
 *
 * POST /job-queue/enqueue                — enqueue a registered job
 * GET  /job-queue/metrics                — queue depth counters
 * GET  /job-queue/jobs?state=&name=      — list jobs (filterable)
 * GET  /job-queue/dead-letters           — inspect the DLQ
 * POST /job-queue/dead-letters/:id/requeue — retry a dead-lettered job
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../middleware/errorHandler.js';
import { jobQueue } from '../services/job-queue/index.js';
import type { JobState } from '../services/job-queue/index.js';

export const jobQueueRouter = Router();
const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const jobStateSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'dead']);

const enqueueSchema = z.object({
  name: z.string().min(1),
  payload: z.unknown().optional(),
});

// ── POST /job-queue/enqueue ──────────────────────────────────────────────────

jobQueueRouter.post(
  '/enqueue',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = enqueueSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Invalid payload', details: parsed.error.format() });
    }
    if (!jobQueue.hasHandler(parsed.data.name)) {
      return res.status(404).json({ success: false, error: `No handler registered for job "${parsed.data.name}"` });
    }

    const job = jobQueue.enqueue(parsed.data.name, parsed.data.payload ?? {});
    return res.status(202).json({ success: true, data: job });
  }),
);

// ── GET /job-queue/metrics ───────────────────────────────────────────────────

jobQueueRouter.get(
  '/metrics',
  asyncHandler(async (_req: Request, res: Response) => {
    return res.json({ success: true, data: jobQueue.metrics() });
  }),
);

// ── GET /job-queue/jobs ──────────────────────────────────────────────────────

jobQueueRouter.get(
  '/jobs',
  asyncHandler(async (req: Request, res: Response) => {
    const stateParse = jobStateSchema.safeParse(req.query.state);
    const state: JobState | undefined = stateParse.success ? stateParse.data : undefined;
    const name = (req.query.name as string) || undefined;

    return res.json({ success: true, data: jobQueue.listJobs({ state, name }) });
  }),
);

// ── GET /job-queue/dead-letters ──────────────────────────────────────────────

jobQueueRouter.get(
  '/dead-letters',
  asyncHandler(async (_req: Request, res: Response) => {
    return res.json({ success: true, data: jobQueue.getDeadLetters() });
  }),
);

// ── POST /job-queue/dead-letters/:id/requeue ─────────────────────────────────

jobQueueRouter.post(
  '/dead-letters/:id/requeue',
  asyncHandler(async (req: Request, res: Response) => {
    const requeued = jobQueue.requeueDeadLetter(firstParam(req.params.id));
    if (!requeued) {
      return res.status(404).json({ success: false, error: 'Dead letter not found' });
    }
    return res.json({ success: true, data: requeued });
  }),
);
