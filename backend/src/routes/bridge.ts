import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import {
  createBridgeTransfer,
  getBridgeAnalytics,
  getBridgeConfig,
  getBridgeTransfer,
  listBridgeTransfers,
  transitionBridgeTransfer,
  updateBridgeConfig,
} from '../services/bridge.js';

export const bridgeRouter = Router();

const createBridgeSchema = z.object({
  fromChain: z.string().min(1),
  toChain: z.string().min(1),
  sender: z.string().min(1),
  recipient: z.string().min(1),
  amount: z.number().positive(),
  minAmountOut: z.number().positive(),
  hashlock: z.string().min(16),
  timelockUnix: z.number().int().positive(),
  route: z.array(z.string().min(1)).optional(),
});

const configSchema = z.object({
  feeBps: z.number().int().min(0).max(1000).optional(),
  slippageBps: z.number().int().min(0).max(3000).optional(),
  disputeWindowSeconds: z.number().int().min(60).max(86_400).optional(),
  paused: z.boolean().optional(),
});

const transitionSchema = z.object({
  status: z.enum(['locked', 'relayed', 'redeemed', 'refunded', 'disputed']),
});

bridgeRouter.post(
  '/transfers',
  validate(createBridgeSchema),
  asyncHandler(async (req, res) => {
    try {
      const transfer = createBridgeTransfer(req.body);
      res.status(201).json(transfer);
    } catch (error) {
      throw new AppError(400, error instanceof Error ? error.message : String(error), 'BRIDGE_INVALID');
    }
  })
);

bridgeRouter.get(
  '/transfers',
  asyncHandler(async (_req, res) => {
    res.json({ data: listBridgeTransfers() });
  })
);

bridgeRouter.get(
  '/transfers/:id',
  asyncHandler(async (req, res) => {
    const transfer = getBridgeTransfer(req.params.id);
    if (!transfer) throw new AppError(404, 'Transfer not found', 'NOT_FOUND');
    res.json(transfer);
  })
);

bridgeRouter.post(
  '/transfers/:id/transition',
  validate(transitionSchema),
  asyncHandler(async (req, res) => {
    const updated = transitionBridgeTransfer(req.params.id, req.body.status);
    if (!updated) throw new AppError(404, 'Transfer not found', 'NOT_FOUND');
    res.json(updated);
  })
);

bridgeRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json(getBridgeConfig());
  })
);

bridgeRouter.post(
  '/config',
  validate(configSchema),
  asyncHandler(async (req, res) => {
    res.json(updateBridgeConfig(req.body));
  })
);

bridgeRouter.get(
  '/analytics',
  asyncHandler(async (_req, res) => {
    res.json(getBridgeAnalytics());
  })
);
