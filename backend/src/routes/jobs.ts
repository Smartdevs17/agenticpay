import { Router } from 'express';
import { getJobScheduler } from '../jobs/index.js';
import { paginateArray } from '../utils/pagination.js';

export const jobsRouter = Router();

jobsRouter.get('/', (req, res) => {
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
