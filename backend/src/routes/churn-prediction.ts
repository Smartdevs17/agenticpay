import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { churnPredictionService, ChurnEvent } from '../services/churn-prediction.js';

export const churnPredictionRouter = Router();

churnPredictionRouter.post('/events', asyncHandler(async (req, res) => {
  const { customerId, event, occurredAt } = req.body as Record<string, unknown>;
  if (typeof customerId !== 'string' || typeof event !== 'string') {
    throw new AppError(400, 'customerId and event are required', 'VALIDATION_ERROR');
  }
  const date = occurredAt === undefined ? new Date() : new Date(String(occurredAt));
  if (Number.isNaN(date.getTime())) throw new AppError(400, 'occurredAt must be valid', 'VALIDATION_ERROR');
  churnPredictionService.track({ customerId, event: event as ChurnEvent['event'], occurredAt: date });
  res.status(201).json({ ok: true });
}));

churnPredictionRouter.get('/:customerId', asyncHandler(async (req, res) => {
  res.json({ data: churnPredictionService.predict(req.params.customerId) });
}));