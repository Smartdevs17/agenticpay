/**
 * Pre-execution swap simulation routes — Issue #521
 *
 * Clients call this before submitting a swap/settlement on-chain to get the
 * expected output, the hard minAmountOut floor, and a sandwich-attack risk
 * assessment. The returned `minAmountOut` is the same value that should be
 * passed to SlippageGuard.executeGuardedSettlement on-chain.
 */

import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { simulateSwapSchema } from '../schemas/index.js';
import { simulateSwap, InvalidSimulationInputError, MAX_SLIPPAGE_BPS, DEFAULT_SLIPPAGE_BPS } from '../services/slippage-protection.js';

export const swapSimulationRouter = Router();

swapSimulationRouter.post(
  '/simulate',
  validate(simulateSwapSchema),
  asyncHandler(async (req, res) => {
    try {
      const result = simulateSwap(req.body);
      res.json(result);
    } catch (err) {
      if (err instanceof InvalidSimulationInputError) throw new AppError(400, err.message, 'INVALID_SIMULATION_INPUT');
      throw err;
    }
  })
);

swapSimulationRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json({ maxSlippageBps: MAX_SLIPPAGE_BPS, defaultSlippageBps: DEFAULT_SLIPPAGE_BPS });
  })
);
