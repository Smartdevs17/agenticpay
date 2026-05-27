import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { relayTransaction, RelayError } from '../relayer/relay.js';
import { getRelayerHealth, estimateGas } from '../relayer/health.js';
import { relayRequestSchema } from '../relayer/schema.js';

export const relayerRouter = Router();

/**
 * POST /api/v1/relayer/relay
 * Submit a gasless transaction using an off-chain authorization token.
 */
relayerRouter.post(
  '/relay',
  validate(relayRequestSchema),
  asyncHandler(async (req, res) => {
    try {
      const result = await relayTransaction(req.body);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      if (err instanceof RelayError) {
        res.status(err.statusCode).json({
          success: false,
          error: { code: err.code, message: err.message },
        });
        return;
      }
      throw err;
    }
  })
);

/**
 * GET /api/v1/relayer/health
 * Returns relayer health status and balance.
 */
relayerRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const relayerAddress = process.env.RELAYER_PUBLIC_KEY;
    const health = await getRelayerHealth(relayerAddress);
    const statusCode = health.status === 'unavailable' ? 503 : 200;
    res.status(statusCode).json({ success: true, data: health });
  })
);

/**
 * GET /api/v1/relayer/estimate
 * Returns current gas/fee estimate for a relayed transaction.
 */
relayerRouter.get(
  '/estimate',
  asyncHandler(async (_req, res) => {
    const estimate = estimateGas();
    res.json({ success: true, data: estimate });
  })
);
