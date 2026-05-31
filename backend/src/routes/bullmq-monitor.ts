/**
 * BullMQ queue monitoring API.
 *
 * Exposes real-time queue depth and job-status counts for all
 * distributed task queues managed by the BullMQ scheduler.
 */

import { Router, Request, Response } from 'express';
import { getBullMQScheduler } from '../services/bullmq-scheduler.js';

export const bullMQMonitorRouter = Router();

/**
 * GET /api/v1/queue/metrics
 * Returns per-queue depth and job status counts.
 * When BullMQ is not configured (Redis unavailable) returns an empty array
 * with a flag indicating the in-process scheduler is active.
 */
bullMQMonitorRouter.get('/metrics', async (_req: Request, res: Response) => {
  const scheduler = getBullMQScheduler();

  if (!scheduler) {
    res.json({
      distributed: false,
      message: 'BullMQ scheduler is not active (Redis not configured). Using in-process node-cron.',
      queues: [],
    });
    return;
  }

  try {
    const metrics = await scheduler.getMetrics();
    res.json({ distributed: true, queues: metrics, total: metrics.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: { code: 'METRICS_FETCH_FAILED', message } });
  }
});

/**
 * POST /api/v1/queue/:taskId/run
 * Trigger a task to run immediately via the BullMQ queue.
 */
bullMQMonitorRouter.post('/:taskId/run', async (req: Request, res: Response) => {
  const scheduler = getBullMQScheduler();

  if (!scheduler) {
    res.status(503).json({
      error: { code: 'DISTRIBUTED_SCHEDULER_UNAVAILABLE', message: 'BullMQ scheduler is not active' },
    });
    return;
  }

  try {
    await scheduler.runTaskNow(req.params.taskId);
    res.json({ ok: true, taskId: req.params.taskId, queued: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: { code: 'TASK_QUEUE_FAILED', message } });
  }
});

/**
 * POST /api/v1/queue/:taskId/pause
 * Pause a task queue (stops workers from processing new jobs).
 */
bullMQMonitorRouter.post('/:taskId/pause', async (req: Request, res: Response) => {
  const scheduler = getBullMQScheduler();
  if (!scheduler) {
    res.status(503).json({ error: { code: 'DISTRIBUTED_SCHEDULER_UNAVAILABLE', message: 'BullMQ scheduler is not active' } });
    return;
  }
  await scheduler.pauseTask(req.params.taskId);
  res.json({ ok: true, taskId: req.params.taskId, action: 'paused' });
});

/**
 * POST /api/v1/queue/:taskId/resume
 * Resume a paused task queue.
 */
bullMQMonitorRouter.post('/:taskId/resume', async (req: Request, res: Response) => {
  const scheduler = getBullMQScheduler();
  if (!scheduler) {
    res.status(503).json({ error: { code: 'DISTRIBUTED_SCHEDULER_UNAVAILABLE', message: 'BullMQ scheduler is not active' } });
    return;
  }
  await scheduler.resumeTask(req.params.taskId);
  res.json({ ok: true, taskId: req.params.taskId, action: 'resumed' });
});
