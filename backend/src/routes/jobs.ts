import { Router, Request, Response } from 'express';
import { getJobScheduler } from '../jobs/index.js';
import { getScheduledTaskDashboard } from '../config/scheduled-tasks.js';
import { paginateArray } from '../utils/pagination.js';

export const jobsRouter = Router();

/**
 * GET /api/v1/jobs
 * Paginated list of live job statuses from the in-process scheduler.
 */
jobsRouter.get('/', (req: Request, res: Response) => {
  const scheduler = getJobScheduler();
  const statuses = scheduler?.getStatuses() ?? [];

  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

  const paginated = paginateArray(statuses, { limit, offset });

  res.json({
    jobs: paginated.data,
    total: paginated.total,
    limit: paginated.limit,
    offset: paginated.offset,
  });
});

/**
 * GET /api/v1/jobs/dashboard
 * Returns task metadata + next upcoming run times for all configured tasks.
 * Useful for ops dashboards and health checks.
 */
jobsRouter.get('/dashboard', (_req: Request, res: Response) => {
  const scheduler = getJobScheduler();
  const liveStatuses = scheduler ? Object.fromEntries(
    scheduler.getStatuses().map((s) => [s.id, s]),
  ) : {};

  const dashboard = getScheduledTaskDashboard().map((task) => ({
    ...task,
    liveStatus: liveStatuses[task.id] ?? null,
  }));

  res.json({ data: dashboard, total: dashboard.length });
});

/**
 * POST /api/v1/jobs/:id/run
 * Trigger a job to run immediately (outside its schedule).
 */
jobsRouter.post('/:id/run', async (req: Request, res: Response) => {
  const scheduler = getJobScheduler();
  if (!scheduler) {
    res.status(503).json({ error: { code: 'SCHEDULER_UNAVAILABLE', message: 'Job scheduler is not running' } });
    return;
  }

  try {
    await scheduler.runJobNow(req.params.id);
    res.json({ ok: true, jobId: req.params.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: { code: 'JOB_RUN_FAILED', message } });
  }
});

/**
 * POST /api/v1/jobs/:id/pause
 * Pause a running cron job.
 */
jobsRouter.post('/:id/pause', (req: Request, res: Response) => {
  const scheduler = getJobScheduler();
  if (!scheduler) {
    res.status(503).json({ error: { code: 'SCHEDULER_UNAVAILABLE', message: 'Job scheduler is not running' } });
    return;
  }
  scheduler.pauseJob(req.params.id);
  res.json({ ok: true, jobId: req.params.id, action: 'paused' });
});

/**
 * POST /api/v1/jobs/:id/resume
 * Resume a paused cron job.
 */
jobsRouter.post('/:id/resume', (req: Request, res: Response) => {
  const scheduler = getJobScheduler();
  if (!scheduler) {
    res.status(503).json({ error: { code: 'SCHEDULER_UNAVAILABLE', message: 'Job scheduler is not running' } });
    return;
  }
  scheduler.resumeJob(req.params.id);
  res.json({ ok: true, jobId: req.params.id, action: 'resumed' });
});
