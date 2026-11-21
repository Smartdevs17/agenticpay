/**
 * Issue #488 — BullMQ admin API
 *
 * GET  /api/v1/queues/jobs          — list all registered job definitions
 * GET  /api/v1/queues/metrics       — per-job runtime metrics
 * POST /api/v1/queues/jobs/:name/enqueue — manually enqueue a job
 */

import { Router, type Request, type Response } from 'express';
import { getBullMQRegistry } from './index.js';

export const queuesRouter = Router();

queuesRouter.get('/jobs', (_req: Request, res: Response) => {
  const registry = getBullMQRegistry();
  if (!registry) {
    res.status(503).json({ error: 'Queue registry not started' });
    return;
  }
  res.json({ jobs: registry.listJobs() });
});

queuesRouter.get('/metrics', (_req: Request, res: Response) => {
  const registry = getBullMQRegistry();
  if (!registry) {
    res.status(503).json({ error: 'Queue registry not started' });
    return;
  }
  res.json({ metrics: registry.getMetrics() });
});

queuesRouter.post('/jobs/:name/enqueue', async (req: Request, res: Response) => {
  const registry = getBullMQRegistry();
  if (!registry) {
    res.status(503).json({ error: 'Queue registry not started' });
    return;
  }
  try {
    const jobName = String(req.params.name);
    await registry.enqueue(jobName, req.body ?? {});
    res.json({ ok: true, job: jobName });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});
