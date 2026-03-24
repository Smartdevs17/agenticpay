import { Router } from 'express';
import { getJobScheduler } from '../jobs/index.js';

export const jobsRouter = Router();

jobsRouter.get('/', (_req, res) => {
  const scheduler = getJobScheduler();
  const statuses = scheduler?.getStatuses() ?? [];
  res.json({ jobs: statuses });
});
