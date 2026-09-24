// ML Revenue Forecasting routes — Issue #854
// Mount at /api/v1/forecast/ml

import { Router, Request, Response } from 'express';
import { mlForecastService } from '../services/ml-forecast.js';
import { analyticsService } from '../services/analytics.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

export const mlForecastRouter = Router();

// Predict from supplied historical or from analytics time series if not provided
mlForecastRouter.post(
  '/predict',
  asyncHandler(async (req: Request, res: Response) => {
    const { historical, horizon, granularity } = req.body as Record<string, unknown>;
    let points: Array<{ timestamp: string; value: number }>;
    if (Array.isArray(historical) && historical.length > 0) {
      points = (historical as Array<{ timestamp: string; value: number }>).map((p) => ({
        timestamp: String(p.timestamp),
        value: Number(p.value),
      }));
      if (points.some((p) => Number.isNaN(p.value))) throw new AppError(400, 'historical values must be numbers', 'VALIDATION_ERROR');
    } else {
      // fallback to analytics daily revenue
      const sinceStr = typeof req.query.since === 'string' ? req.query.since : undefined;
      const since = sinceStr ? new Date(sinceStr) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const series = analyticsService.buildTimeSeries((granularity === 'hour' ? 'hour' : 'day') as 'hour' | 'day', since);
      points = series.map((s) => ({ timestamp: s.timestamp, value: s.revenue }));
      if (points.length === 0) throw new AppError(400, 'No historical data available. Provide historical array.', 'VALIDATION_ERROR');
    }
    const h = typeof horizon === 'number' && horizon > 0 && horizon <= 365 ? Math.floor(horizon) : 30;
    const result = mlForecastService.forecast(points, h);
    res.json(result);
  }),
);

mlForecastRouter.get(
  '/predict',
  asyncHandler(async (req: Request, res: Response) => {
    const horizon = req.query.horizon ? Number(req.query.horizon) : 30;
    const granularity = req.query.granularity === 'hour' ? 'hour' : 'day';
    const sinceStr = typeof req.query.since === 'string' ? req.query.since : undefined;
    const since = sinceStr ? new Date(sinceStr) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const series = analyticsService.buildTimeSeries(granularity as 'hour' | 'day', since);
    if (series.length < 2) throw new AppError(400, 'Not enough historical data', 'VALIDATION_ERROR');
    const points = series.map((s) => ({ timestamp: s.timestamp, value: s.revenue }));
    const result = mlForecastService.forecast(points, horizon > 0 && horizon <= 365 ? horizon : 30);
    res.json(result);
  }),
);

// Evaluate models for supplied data
mlForecastRouter.post(
  '/evaluate',
  asyncHandler(async (req: Request, res: Response) => {
    const { historical } = req.body as Record<string, unknown>;
    if (!Array.isArray(historical) || historical.length < 10) {
      throw new AppError(400, 'historical array with at least 10 points required', 'VALIDATION_ERROR');
    }
    const values = (historical as Array<{ value: number }>).map((p) => Number(p.value));
    const models = mlForecastService.evaluateModels(values);
    res.json({ models, bestModel: models.sort((a, b) => a.rmse - b.rmse)[0]?.model ?? null });
  }),
);

// Feature engineering
mlForecastRouter.post(
  '/features',
  asyncHandler(async (req: Request, res: Response) => {
    const { historical, window } = req.body as Record<string, unknown>;
    if (!Array.isArray(historical) || historical.length === 0) throw new AppError(400, 'historical required', 'VALIDATION_ERROR');
    const values = (historical as Array<{ value: number }>).map((p) => Number(p.value));
    const w = typeof window === 'number' ? window : 7;
    const features = mlForecastService.buildFeatures(values, w);
    res.json({ features, count: features.length });
  }),
);
