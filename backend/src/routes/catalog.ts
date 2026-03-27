import { Router } from 'express';
import { getCatalog } from '../services/catalog.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const catalogRouter = Router();

catalogRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const catalog = getCatalog();
    res.json(catalog);
  })
);
