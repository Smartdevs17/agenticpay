import { Router, Request, Response } from 'express';
import { getAnalyticsSummary } from '../middleware/rate-limit.js';

export const rateLimitAnalyticsRouter = Router();

/**
 * GET /api/v1/rate-limit/analytics
 * Returns rate-limit analytics for the requested time window.
 * Query param: windowMs (default 60000)
 */
rateLimitAnalyticsRouter.get('/analytics', (req: Request, res: Response) => {
  const windowMs = Number(req.query['windowMs']) || 60_000;
  const summary = getAnalyticsSummary(windowMs);
  res.json({ data: summary });
});
