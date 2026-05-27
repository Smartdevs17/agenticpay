/**
 * Gas estimation HTTP surface.
 *
 * Endpoints are deliberately side-effect-free — they read from the
 * in-process baseline registry and return stable, deterministic numbers.
 * They intentionally don't call out to an RPC; consumers who need the
 * real `eth_estimateGas` should keep using `viem`/`ethers` directly.
 */
import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  batchEstimateSchema,
  estimateSchema,
  metaTxEstimateSchema,
} from '../schemas/gas.js';
import {
  composeFees,
  estimate,
  estimateBatch,
  estimateMetaTx,
  listBaselines,
  listTargets,
} from '../services/gas.js';

export const gasRouter = Router();

gasRouter.get(
  '/targets',
  asyncHandler(async (_req, res) => {
    res.json({ data: listTargets(), timestamp: new Date() });
  }),
);

gasRouter.get(
  '/benchmarks',
  asyncHandler(async (_req, res) => {
    res.json({ data: listBaselines(), timestamp: new Date() });
  }),
);

gasRouter.post(
  '/estimate',
  validate(estimateSchema),
  asyncHandler(async (req, res) => {
    try {
      const result = estimate(req.body);
      const fees = req.body.fee ? composeFees(result, req.body.fee) : undefined;
      res.json({ data: { estimate: result, fees }, timestamp: new Date() });
    } catch (err) {
      throw translate(err, 400, 'GAS_ESTIMATE_FAILED');
    }
  }),
);

gasRouter.post(
  '/batch/estimate',
  validate(batchEstimateSchema),
  asyncHandler(async (req, res) => {
    try {
      res.json({ data: estimateBatch(req.body), timestamp: new Date() });
    } catch (err) {
      throw translate(err, 400, 'GAS_BATCH_ESTIMATE_FAILED');
    }
  }),
);

gasRouter.post(
  '/meta-tx/estimate',
  validate(metaTxEstimateSchema),
  asyncHandler(async (req, res) => {
    try {
      res.json({ data: estimateMetaTx(req.body), timestamp: new Date() });
    } catch (err) {
      throw translate(err, 400, 'GAS_META_TX_ESTIMATE_FAILED');
    }
  }),
);

function translate(err: unknown, status: number, code: string): AppError {
  if (err instanceof AppError) return err;
  return new AppError(status, err instanceof Error ? err.message : String(err), code);
}
