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
  multisigPolicy: z.object({
    groupId: z.string().min(1),
    threshold: z.number().int().min(1),
    challengePeriodMs: z.number().int().min(0),
  }).optional(),
});

const resolveDisputeSchema = z.object({
  type: z.enum(['release_to_freelancer', 'refund_to_client', 'split']),
  freelancerPercent: z.number().min(0).max(100).optional(),
  clientPercent: z.number().min(0).max(100).optional(),
  approvedBy: z.array(z.string().min(1)).min(1),
});

const releaseRequestSchema = z.object({
  initiator: z.string().min(1),
  type: z.enum(['release_to_freelancer', 'refund_to_client', 'split']),
});

const approvalSchema = z.object({
  signer: z.string().min(1),
  signature: z.string().min(1),
});

const rejectionSchema = z.object({
  signer: z.string().min(1),
  signature: z.string().min(1),
  reason: z.string().optional(),
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

// ---------------------------------------------------------------------------
// Multi-sig release endpoints (#564)
// ---------------------------------------------------------------------------

escrowRouter.post('/:id/release-request', validate(releaseRequestSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const request = await escrowService.createReleaseRequest(req.params.id, req.body.initiator, req.body.type);
    res.status(201).json(request);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}));

escrowRouter.post('/:id/release-request/approve', validate(approvalSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const request = await escrowService.approveReleaseRequest(req.params.id, req.body.signer, req.body.signature);
    res.json(request);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}));

escrowRouter.post('/:id/release-request/reject', validate(rejectionSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const request = await escrowService.rejectReleaseRequest(req.params.id, req.body.signer, req.body.signature, req.body.reason);
    res.json(request);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}));

escrowRouter.post('/execute-ready-releases', asyncHandler(async (_req: Request, res: Response) => {
  const executed = await escrowService.executeReadyReleases();
  res.json({ executed });
}));

escrowRouter.get('/:id/release-request', asyncHandler(async (req: Request, res: Response) => {
  const request = escrowService.getReleaseRequest(req.params.id);
  if (!request) return res.status(404).json({ error: 'No release request found' });
  res.json(request);
}));

// ---------------------------------------------------------------------------
// Query routes
// ---------------------------------------------------------------------------

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
