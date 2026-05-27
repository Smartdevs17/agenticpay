import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  engineerFeatures,
  getModelState,
  getReviewQueue,
  getThresholds,
  runAdversarialRobustnessProbe,
  scoreTransaction,
  trainModel,
  updateThresholds,
} from '../services/fraud-detection.js';

export const fraudDetectionRouter = Router();

const transactionSchema = z.object({
  transactionId: z.string().min(1),
  accountAgeDays: z.number().nonnegative(),
  amountUsd: z.number().nonnegative(),
  velocity1h: z.number().nonnegative(),
  geoDistanceKm: z.number().nonnegative(),
  deviceRisk: z.number().min(0).max(1),
  failedAttempts24h: z.number().nonnegative(),
  chargebacks90d: z.number().nonnegative(),
});

const trainSchema = z.object({
  samples: z.array(transactionSchema.extend({ label: z.union([z.literal(0), z.literal(1)]) })).min(1),
  learningRate: z.number().positive().max(1).optional(),
  epochs: z.number().int().positive().max(2000).optional(),
});

const thresholdSchema = z.object({
  review: z.number().min(0).max(1).optional(),
  block: z.number().min(0).max(1).optional(),
});

fraudDetectionRouter.post(
  '/score',
  validate(transactionSchema),
  asyncHandler(async (req, res) => {
    const scored = scoreTransaction(req.body);
    res.json({
      ...scored,
      features: engineerFeatures(req.body),
      thresholds: getThresholds(),
    });
  })
);

fraudDetectionRouter.post(
  '/train',
  validate(trainSchema),
  asyncHandler(async (req, res) => {
    const { samples, learningRate, epochs } = req.body;
    const trained = trainModel(samples, learningRate, epochs);
    res.json({
      message: 'Model retrained',
      model: trained,
    });
  })
);

fraudDetectionRouter.get(
  '/model',
  asyncHandler(async (_req, res) => {
    res.json(getModelState());
  })
);

fraudDetectionRouter.get(
  '/review-queue',
  asyncHandler(async (_req, res) => {
    res.json({ data: getReviewQueue() });
  })
);

fraudDetectionRouter.post(
  '/thresholds',
  validate(thresholdSchema),
  asyncHandler(async (req, res) => {
    const thresholds = updateThresholds(req.body);
    res.json({ thresholds });
  })
);

fraudDetectionRouter.post(
  '/robustness-test',
  validate(transactionSchema),
  asyncHandler(async (req, res) => {
    res.json(runAdversarialRobustnessProbe(req.body));
  })
);
