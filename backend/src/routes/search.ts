/**
 * Full-text search routes — Issue #885
 *
 * GET /api/v1/search/payments?q=...&tenantId=...&limit=...&cursor=...
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError } from '../types/errors';
import { searchPayments } from '../services/search/payment-search.service.js';

export const searchRouter = Router();

searchRouter.get(
  '/payments',
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query.q;
    if (typeof q !== 'string' || !q.trim()) {
      throw new ValidationError('Query parameter "q" is required');
    }

    const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;

    const results = await searchPayments(q, { tenantId, limit, cursor });
    res.json({ data: results, meta: { query: q, count: results.length } });
  }),
);
