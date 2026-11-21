import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { htlcManagerService } from '../services/swaps/htlc-manager.js';

export const swapsRouter = Router();

function resolveTenant(req: any): string {
  return (req.headers['x-tenant-id'] as string) ?? 'default';
}

swapsRouter.post('/', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const swap = await htlcManagerService.createSwap({ ...req.body, tenantId });
  res.status(201).json(swap);
}));

swapsRouter.get('/', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const { status, limit } = req.query as any;
  const swaps = await htlcManagerService.listSwaps(tenantId, { status, limit: limit ? parseInt(limit) : undefined });
  res.json({ swaps });
}));

swapsRouter.get('/:id', asyncHandler(async (req, res) => {
  const swap = await htlcManagerService.getSwap(req.params.id);
  res.json(swap);
}));

swapsRouter.post('/:id/claim', asyncHandler(async (req, res) => {
  const { preimage } = req.body as { preimage: string };
  if (!preimage) throw new AppError(400, 'Preimage is required', 'MISSING_PREIMAGE');
  const swap = await htlcManagerService.claimSwap({ swapId: req.params.id, preimage });
  res.json(swap);
}));

swapsRouter.post('/:id/refund', asyncHandler(async (req, res) => {
  const swap = await htlcManagerService.refundSwap(req.params.id);
  res.json(swap);
}));
