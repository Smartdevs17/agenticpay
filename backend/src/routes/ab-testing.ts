// A/B Testing Framework routes — Issue #852
// Mount at /api/v1/ab-tests

import { Router, Request, Response } from 'express';
import { abTestingService } from '../services/ab-testing.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

export const abTestingRouter = Router();

// Create experiment
abTestingRouter.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { id, name, description, hypothesis, variants, primaryMetric, secondaryMetrics, trafficAllocation, createdBy } =
      req.body as Record<string, unknown>;
    if (!name || typeof name !== 'string') throw new AppError(400, 'name is required', 'VALIDATION_ERROR');
    if (!Array.isArray(variants)) throw new AppError(400, 'variants array required', 'VALIDATION_ERROR');
    try {
      const exp = abTestingService.createExperiment({
        id: typeof id === 'string' ? id : undefined,
        name,
        description: typeof description === 'string' ? description : undefined,
        hypothesis: typeof hypothesis === 'string' ? hypothesis : undefined,
        variants: variants as Array<{ key: string; name: string; weight: number; payload?: unknown; isControl?: boolean }>,
        primaryMetric: typeof primaryMetric === 'string' ? primaryMetric : undefined,
        secondaryMetrics: Array.isArray(secondaryMetrics) ? (secondaryMetrics as string[]) : undefined,
        trafficAllocation: typeof trafficAllocation === 'number' ? trafficAllocation : undefined,
        createdBy: typeof createdBy === 'string' ? createdBy : undefined,
      });
      res.status(201).json({ experiment: exp });
    } catch (e: unknown) {
      throw new AppError(400, (e as Error).message, 'VALIDATION_ERROR');
    }
  }),
);

// List experiments
abTestingRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const valid = ['draft', 'running', 'paused', 'completed', 'archived'] as const;
    const filter = status && (valid as readonly string[]).includes(status) ? { status: status as typeof valid[number] } : undefined;
    res.json({ experiments: abTestingService.listExperiments(filter) });
  }),
);

// Get experiment
abTestingRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const exp = abTestingService.getExperiment(req.params.id);
    if (!exp) throw new AppError(404, 'Experiment not found', 'NOT_FOUND');
    res.json({ experiment: exp });
  }),
);

// Update experiment
abTestingRouter.patch(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { name, description, hypothesis, trafficAllocation } = req.body as Record<string, unknown>;
    try {
      const exp = abTestingService.updateExperiment(req.params.id, {
        name: typeof name === 'string' ? name : undefined,
        description: typeof description === 'string' ? description : undefined,
        hypothesis: typeof hypothesis === 'string' ? hypothesis : undefined,
        trafficAllocation: typeof trafficAllocation === 'number' ? trafficAllocation : undefined,
      });
      if (!exp) throw new AppError(404, 'Experiment not found', 'NOT_FOUND');
      res.json({ experiment: exp });
    } catch (e: unknown) {
      throw new AppError(400, (e as Error).message, 'VALIDATION_ERROR');
    }
  }),
);

// Delete
abTestingRouter.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const ok = abTestingService.deleteExperiment(req.params.id);
      if (!ok) throw new AppError(404, 'Experiment not found', 'NOT_FOUND');
      res.json({ ok: true });
    } catch (e: unknown) {
      throw new AppError(400, (e as Error).message, 'VALIDATION_ERROR');
    }
  }),
);

// Lifecycle: start / pause / complete / archive
abTestingRouter.post(
  '/:id/start',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const exp = abTestingService.startExperiment(req.params.id);
      res.json({ experiment: exp });
    } catch (e: unknown) {
      throw new AppError(400, (e as Error).message, 'VALIDATION_ERROR');
    }
  }),
);
abTestingRouter.post(
  '/:id/pause',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const exp = abTestingService.pauseExperiment(req.params.id);
      res.json({ experiment: exp });
    } catch (e: unknown) {
      throw new AppError(400, (e as Error).message, 'VALIDATION_ERROR');
    }
  }),
);
abTestingRouter.post(
  '/:id/complete',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const exp = abTestingService.completeExperiment(req.params.id);
      res.json({ experiment: exp });
    } catch (e: unknown) {
      throw new AppError(400, (e as Error).message, 'VALIDATION_ERROR');
    }
  }),
);
abTestingRouter.post(
  '/:id/archive',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const exp = abTestingService.archiveExperiment(req.params.id);
      res.json({ experiment: exp });
    } catch (e: unknown) {
      throw new AppError(400, (e as Error).message, 'VALIDATION_ERROR');
    }
  }),
);

// Assign variant
abTestingRouter.post(
  '/:id/assign',
  asyncHandler(async (req: Request, res: Response) => {
    const { subjectId } = req.body as Record<string, unknown>;
    if (typeof subjectId !== 'string' || !subjectId) throw new AppError(400, 'subjectId required', 'VALIDATION_ERROR');
    try {
      const { variant, assignment } = abTestingService.assign(req.params.id, subjectId);
      res.json({ variant, assignment });
    } catch (e: unknown) {
      throw new AppError(404, (e as Error).message, 'NOT_FOUND');
    }
  }),
);
abTestingRouter.get(
  '/:id/assign/:subjectId',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { variant, assignment } = abTestingService.assign(req.params.id, req.params.subjectId);
      res.json({ variant, assignment });
    } catch (e: unknown) {
      throw new AppError(404, (e as Error).message, 'NOT_FOUND');
    }
  }),
);

// Exposure
abTestingRouter.post(
  '/:id/exposure',
  asyncHandler(async (req: Request, res: Response) => {
    const { subjectId } = req.body as Record<string, unknown>;
    if (typeof subjectId !== 'string') throw new AppError(400, 'subjectId required', 'VALIDATION_ERROR');
    const a = abTestingService.recordExposure(req.params.id, subjectId);
    if (!a) throw new AppError(404, 'Assignment not found', 'NOT_FOUND');
    res.json({ assignment: a });
  }),
);

// Track metric
abTestingRouter.post(
  '/:id/track',
  asyncHandler(async (req: Request, res: Response) => {
    const { subjectId, metric, value } = req.body as Record<string, unknown>;
    if (typeof subjectId !== 'string') throw new AppError(400, 'subjectId required', 'VALIDATION_ERROR');
    try {
      const ev = abTestingService.trackEvent({
        experimentId: req.params.id,
        subjectId,
        metric: typeof metric === 'string' ? metric : undefined,
        value: typeof value === 'number' ? value : undefined,
      });
      res.status(201).json({ ok: true, event: ev });
    } catch (e: unknown) {
      throw new AppError(400, (e as Error).message, 'VALIDATION_ERROR');
    }
  }),
);

// Results
abTestingRouter.get(
  '/:id/results',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const results = abTestingService.getResults(req.params.id);
      res.json({ results });
    } catch (e: unknown) {
      throw new AppError(404, (e as Error).message, 'NOT_FOUND');
    }
  }),
);

// Bayesian prob
abTestingRouter.get(
  '/:id/bayesian',
  asyncHandler(async (req: Request, res: Response) => {
    const probs = abTestingService.getBayesianProb(req.params.id);
    if (!probs) throw new AppError(404, 'Experiment not found', 'NOT_FOUND');
    res.json({ probabilities: probs });
  }),
);

// Sample size calculator
abTestingRouter.post(
  '/utils/sample-size',
  asyncHandler(async (req: Request, res: Response) => {
    const { baselineRate, mde, alpha, power } = req.body as Record<string, unknown>;
    if (typeof baselineRate !== 'number' || typeof mde !== 'number') {
      throw new AppError(400, 'baselineRate and mde are required numbers', 'VALIDATION_ERROR');
    }
    const n = abTestingService.calculateSampleSize(baselineRate, mde, typeof alpha === 'number' ? alpha : 0.05, typeof power === 'number' ? power : 0.8);
    res.json({ sampleSizePerVariant: n, totalSampleSize: n * 2 });
  }),
);
