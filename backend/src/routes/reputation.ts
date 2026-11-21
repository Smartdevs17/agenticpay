import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  getReputation,
  listReputations,
  getReputationSnapshot,
  recordTransaction,
  awardBadge,
  recalculateAll,
  detectGamingPattern,
} from '../services/reputation.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const reputationRouter = Router();

const recordTransactionSchema = z.object({
  event: z.enum(['completed', 'late', 'disputed', 'quality_rated']),
  weight: z.number().positive().optional(),
});

const awardBadgeSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

reputationRouter.get('/:userId', asyncHandler(async (req: Request, res: Response) => {
  const reputation = getReputation(req.params.userId);
  if (!reputation) return res.status(404).json({ error: 'Reputation not found' });
  res.json(reputation);
}));

reputationRouter.get('/:userId/snapshot', asyncHandler(async (req: Request, res: Response) => {
  const snapshot = getReputationSnapshot(req.params.userId);
  if (!snapshot) return res.status(404).json({ error: 'Reputation not found' });
  res.json(snapshot);
}));

reputationRouter.post('/:userId/transaction', asyncHandler(async (req: Request, res: Response) => {
  const { event, weight } = recordTransactionSchema.parse(req.body);
  const reputation = recordTransaction(req.params.userId, event, weight);
  res.json(reputation);
}));

reputationRouter.post('/:userId/badges', asyncHandler(async (req: Request, res: Response) => {
  const { name, description } = awardBadgeSchema.parse(req.body);
  const reputation = awardBadge(req.params.userId, name, description);
  res.json(reputation);
}));

reputationRouter.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const reputations = listReputations();
  res.json({ reputations, total: reputations.length });
}));

reputationRouter.post('/recalculate', asyncHandler(async (_req: Request, res: Response) => {
  recalculateAll();
  res.json({ success: true, message: 'Recalculation started' });
}));

reputationRouter.get('/:userId/gaming-check', asyncHandler(async (req: Request, res: Response) => {
  const result = detectGamingPattern(req.params.userId);
  res.json(result);
}));
