import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { escrowService } from '../services/escrow.js';

export const escrowRouter = Router();

const createEscrowSchema = z.object({
  projectId: z.string().min(1),
  clientAddress: z.string().min(1),
  freelancerAddress: z.string().min(1),
  arbitratorAddresses: z.array(z.string().min(1)).min(1),
  amount: z.string().min(1),
  asset: z.string().min(1),
  network: z.string().min(1),
  deadline: z.number().int().positive(),
});

const resolveDisputeSchema = z.object({
  type: z.enum(['release_to_freelancer', 'refund_to_client', 'split']),
  freelancerPercent: z.number().min(0).max(100).optional(),
  clientPercent: z.number().min(0).max(100).optional(),
  approvedBy: z.array(z.string().min(1)).min(1),
});

escrowRouter.post('/', validate(createEscrowSchema), asyncHandler(async (req: Request, res: Response) => {
  const escrow = await escrowService.createEscrow(req.body);
  res.status(201).json(escrow);
}));

escrowRouter.post('/:id/fund', asyncHandler(async (req: Request, res: Response) => {
  const { txHash } = req.body;
  if (!txHash) return res.status(400).json({ error: 'txHash required' });
  const escrow = await escrowService.fundEscrow(req.params.id, txHash);
  if (!escrow) return res.status(404).json({ error: 'Escrow not found or not in pending state' });
  res.json(escrow);
}));

escrowRouter.post('/:id/dispute', asyncHandler(async (req: Request, res: Response) => {
  const { raisedBy } = req.body;
  if (!raisedBy) return res.status(400).json({ error: 'raisedBy required' });
  const escrow = await escrowService.raiseDispute(req.params.id, raisedBy);
  if (!escrow) return res.status(404).json({ error: 'Escrow not found or not in fundable state' });
  res.json(escrow);
}));

escrowRouter.post('/:id/resolve', validate(resolveDisputeSchema), asyncHandler(async (req: Request, res: Response) => {
  const escrow = await escrowService.resolveDispute(req.params.id, req.body);
  if (!escrow) return res.status(404).json({ error: 'Escrow not found or not in disputed state' });
  res.json(escrow);
}));

escrowRouter.post('/:id/appeal', asyncHandler(async (req: Request, res: Response) => {
  const { appealTarget } = req.body;
  if (!appealTarget) return res.status(400).json({ error: 'appealTarget required' });
  const escrow = await escrowService.appealDispute(req.params.id, appealTarget);
  if (!escrow) return res.status(404).json({ error: 'Escrow not found or not in disputed state' });
  res.json(escrow);
}));

escrowRouter.post('/:id/timeout-release', asyncHandler(async (req: Request, res: Response) => {
  const escrow = await escrowService.timeoutRelease(req.params.id);
  if (!escrow) return res.status(404).json({ error: 'Escrow not found or not eligible for timeout release' });
  res.json(escrow);
}));

escrowRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const escrows = await escrowService.listEscrows(status as any);
  res.json({ escrows });
}));

escrowRouter.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const escrow = await escrowService.getEscrow(req.params.id);
  if (!escrow) return res.status(404).json({ error: 'Escrow not found' });
  res.json(escrow);
}));
