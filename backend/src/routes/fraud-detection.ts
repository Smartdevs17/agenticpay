import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  scoreTransaction,
  trainModel,
  updateThresholds,
  getThresholds,
  getReviewQueue,
  getModelState,
  runAdversarialRobustnessProbe,
  TransactionSample,
  LabeledSample
} from '../services/fraud-detection.js';
import { AppError } from '../middleware/errorHandler.js';

export const fraudDetectionRouter = express.Router();

// --- Zod Validation Schemas ---

const transactionSampleSchema = z.object({
  transactionId: z.string().min(1, 'Transaction ID is required'),
  accountAgeDays: z.number().nonnegative(),
  amountUsd: z.number().positive(),
  velocity1h: z.number().nonnegative(),
  geoDistanceKm: z.number().nonnegative(),
  deviceRisk: z.number().min(0).max(1),
  failedAttempts24h: z.number().nonnegative(),
  chargebacks90d: z.number().nonnegative(),
});

const thresholdUpdateSchema = z.object({
  review: z.number().min(0).max(1).optional(),
  block: z.number().min(0).max(1).optional(),
});

const trainModelSchema = z.object({
  samples: z.array(
    transactionSampleSchema.extend({
      label: z.union([z.literal(0), z.literal(1)]),
    })
  ).min(1, 'At least one labeled sample is required to train'),
  learningRate: z.number().positive().max(1).optional(),
  epochs: z.number().positive().int().optional(),
});

// --- Endpoints ---

/**
 * @route   POST /api/v1/fraud-detection/score
 * @desc    Real-time transaction risk scoring pipeline (Sub-100ms path)
 */
fraudDetectionRouter.post(
  '/score',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = transactionSampleSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new AppError(
            400,
            'Invalid transaction sample data',
            'VALIDATION_ERROR',
            { errors: parsed.error.flatten().fieldErrors }
          )
        );
      }

      // Executes math calculations synchronously inside the service loop (< 5ms execution footprint)
      const result = scoreTransaction(parsed.data as TransactionSample);
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/v1/fraud-detection/thresholds
 * @desc    Retrieve active configurable risk boundaries
 */
fraudDetectionRouter.get('/thresholds', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: getThresholds(),
  });
});

/**
 * @route   PUT /api/v1/fraud-detection/thresholds
 * @desc    Update rule engine thresholds dynamically
 */
fraudDetectionRouter.put(
  '/thresholds',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = thresholdUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new AppError(
            400,
            'Invalid threshold structural values',
            'VALIDATION_ERROR',
            { errors: parsed.error.flatten().fieldErrors }
          )
        );
      }

      const updated = updateThresholds(parsed.data);
      res.json({
        success: true,
        message: 'Rule boundaries updated successfully',
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/v1/fraud-detection/review-queue
 * @desc    Case management endpoint returning items flagged for manual audit
 */
fraudDetectionRouter.get('/review-queue', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: getReviewQueue(),
  });
});

/**
 * @route   GET /api/v1/fraud-detection/model-state
 * @desc    Fetches operational vector parameters, hyperplanes, and system version
 */
fraudDetectionRouter.get('/model-state', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: getModelState(),
  });
});

/**
 * @route   POST /api/v1/fraud-detection/train
 * @desc    Model retraining pipeline parsing labeled training datasets
 */
fraudDetectionRouter.post(
  '/train',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = trainModelSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new AppError(
            400,
            'Invalid payload structural footprint for model retraining dataset',
            'VALIDATION_ERROR',
            { errors: parsed.error.flatten().fieldErrors }
          )
        );
      }

      const { samples, learningRate, epochs } = parsed.data;
      const updatedModel = trainModel(
        samples as LabeledSample[],
        learningRate,
        epochs
      );

      res.json({
        success: true,
        message: 'Model parameters calculated and synchronized successfully',
        data: {
          version: updatedModel.version,
          trainedSamples: updatedModel.trainedSamples,
          updatedAt: updatedModel.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   POST /api/v1/fraud-detection/probe
 * @desc    A/B testing and security validation via simulated adversarial input perturbations
 */
fraudDetectionRouter.post(
  '/probe',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = transactionSampleSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new AppError(
            400,
            'Invalid transaction trace data for probe configuration',
            'VALIDATION_ERROR',
            { errors: parsed.error.flatten().fieldErrors }
          )
        );
      }

      const analyticsProbe = runAdversarialRobustnessProbe(
        parsed.data as TransactionSample
      );

      res.json({
        success: true,
        data: analyticsProbe,
      });
    } catch (error) {
      next(error);
    }
  }
);