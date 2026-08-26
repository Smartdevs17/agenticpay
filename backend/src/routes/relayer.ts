import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { bridgeRelayerService } from '../services/bridge-relayer.js';

export const relayerRouter = Router();

const initiateSwapSchema = z.object({
  sourceChain: z.enum(['stellar', 'evm']),
  destinationChain: z.enum(['stellar', 'evm']),
  sourceLockId: z.string().min(1),
  sender: z.string().min(1),
  recipient: z.string().min(1),
  amount: z.string().min(1),
  hashlock: z.string().min(16),
  timelockSource: z.number().int().positive(),
  timelockDestination: z.number().int().positive(),
});

const revealSecretSchema = z.object({
  secret: z.string().min(16),
});

const updateConfigSchema = z.object({
  pollIntervalMs: z.number().int().min(1000).optional(),
  sourceChainRpc: z.string().url().optional(),
  destinationChainRpc: z.string().url().optional(),
  maxRetries: z.number().int().min(1).max(10).optional(),
  safetyMarginMs: z.number().int().min(0).optional(),
});

relayerRouter.post(
  '/swaps',
  validate(initiateSwapSchema),
  asyncHandler(async (req, res) => {
    const swap = await bridgeRelayerService.initiateSwap(req.body);
    res.status(201).json(swap);
  })
);

relayerRouter.get(
  '/swaps',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    res.json({ data: bridgeRelayerService.listSwaps(status as any) });
  })
);

relayerRouter.get(
  '/swaps/:id',
  asyncHandler(async (req, res) => {
    const swap = bridgeRelayerService.getSwap(req.params.id);
    if (!swap) return res.status(404).json({ error: 'Swap not found' });
    res.json(swap);
  })
);

relayerRouter.post(
  '/swaps/:id/reveal',
  validate(revealSecretSchema),
  asyncHandler(async (req, res) => {
    const swap = await bridgeRelayerService.revealSecret(req.params.id, req.body.secret);
    if (!swap) return res.status(400).json({ error: 'Swap not found or not in redeemable state' });
    res.json(swap);
  })
);

relayerRouter.get(
  '/analytics',
  asyncHandler(async (_req, res) => {
    res.json(bridgeRelayerService.getAnalytics());
  })
);

relayerRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json(bridgeRelayerService.getConfig());
  })
);

relayerRouter.post(
  '/config',
  validate(updateConfigSchema),
  asyncHandler(async (req, res) => {
    res.json(bridgeRelayerService.updateConfig(req.body));
  })
);

relayerRouter.post(
  '/start',
  asyncHandler(async (_req, res) => {
    bridgeRelayerService.start();
    res.json({ status: 'started' });
  })
);

relayerRouter.post(
  '/stop',
  asyncHandler(async (_req, res) => {
    bridgeRelayerService.stop();
    res.json({ status: 'stopped' });
  })
);
