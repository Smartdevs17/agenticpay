import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { getArchivalService } from '../services/archival/index.js';

export const archivalRouter = Router();

const restoreSchema = z.object({
  batchId: z.string().uuid(),
});

archivalRouter.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const result = await getArchivalService().getDashboard();
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json(result.value);
  }),
);

archivalRouter.get(
  '/batches',
  asyncHandler(async (req, res) => {
    const limit = parseInt(String(req.query.limit ?? '20'), 10);
    const result = await getArchivalService().listBatches(limit);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json(result.value);
  }),
);

archivalRouter.post(
  '/run',
  asyncHandler(async (_req, res) => {
    const result = await getArchivalService().runDailyArchival();
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json(result.value);
  }),
);

archivalRouter.post(
  '/restore',
  validate(restoreSchema),
  asyncHandler(async (req, res) => {
    const result = await getArchivalService().restoreBatch(req.body.batchId);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json(result.value);
  }),
);

archivalRouter.post(
  '/restore/:batchId',
  asyncHandler(async (req, res) => {
    const result = await getArchivalService().restoreBatch(req.params.batchId);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json(result.value);
  }),
);
