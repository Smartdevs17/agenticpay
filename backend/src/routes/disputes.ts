import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { disputeService } from '../disputes/index.js';

export const disputesRouter = Router();

const createDisputeSchema = z.object({
  projectId: z.string().min(1),
  escrowId: z.string().min(1),
  raisedBy: z.string().min(1),
  raisedAgainst: z.string().min(1),
  reason: z.string().min(10),
});

const evidenceSchema = z.object({
  type: z.enum(['document', 'image', 'message', 'other']),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  url: z.string().url(),
  uploadedBy: z.string().min(1),
});

const resolveSchema = z.object({
  type: z.enum(['refund', 'release', 'split']),
  description: z.string().min(1),
  approvedBy: z.string().min(1),
  refundAmount: z.string().optional(),
  releaseAmount: z.string().optional(),
  splitRatio: z.object({ partyA: z.number(), partyB: z.number() }).optional(),
});

disputesRouter.post('/', validate(createDisputeSchema), asyncHandler(async (req: Request, res: Response) => {
  const dispute = await disputeService.createDispute(req.body);
  res.status(201).json(dispute);
}));

disputesRouter.post('/:id/evidence', validate(evidenceSchema), asyncHandler(async (req: Request, res: Response) => {
  const dispute = await disputeService.addEvidence(req.params.id, req.body);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found or already closed' });
  res.json(dispute);
}));

disputesRouter.post('/:id/resolve', validate(resolveSchema), asyncHandler(async (req: Request, res: Response) => {
  const dispute = await disputeService.resolveDispute(req.params.id, req.body);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  res.json(dispute);
}));

disputesRouter.post('/:id/appeal', asyncHandler(async (req: Request, res: Response) => {
  const { appealTarget } = req.body;
  if (!appealTarget) return res.status(400).json({ error: 'appealTarget required' });
  const dispute = await disputeService.appealDispute(req.params.id, appealTarget);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found or not in resolvable state' });
  res.json(dispute);
}));

disputesRouter.post('/:id/close', asyncHandler(async (req: Request, res: Response) => {
  const { closedBy } = req.body;
  if (!closedBy) return res.status(400).json({ error: 'closedBy required' });
  const dispute = await disputeService.closeDispute(req.params.id, closedBy);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  res.json(dispute);
}));

disputesRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const disputes = disputeService.listDisputes(status as any);
  res.json({ disputes, total: disputes.length });
}));

disputesRouter.get('/user/:userId', asyncHandler(async (req: Request, res: Response) => {
  const disputes = disputeService.getDisputesByUser(req.params.userId);
  res.json({ disputes, total: disputes.length });
}));

disputesRouter.get('/arbitrators', asyncHandler(async (_req: Request, res: Response) => {
  const availableOnly = _req.query.available === 'true';
  const arbitrators = disputeService.getArbitratorService().listArbitrators(availableOnly);
  res.json({ arbitrators, workload: disputeService.getArbitratorService().getWorkloadStats() });
}));

disputesRouter.get('/arbitrators/:id', asyncHandler(async (req: Request, res: Response) => {
  const arbitrator = disputeService.getArbitratorService().getArbitrator(req.params.id);
  if (!arbitrator) return res.status(404).json({ error: 'Arbitrator not found' });
  res.json(arbitrator);
}));

disputesRouter.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const arbitratorId = req.query.arbitratorId as string | undefined;
  const arbitrator = arbitratorId ? disputeService.getArbitratorService().getArbitrator(arbitratorId) : undefined;
  const dispute = disputeService.getDispute(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  res.json({ dispute, arbitrator });
}));

disputesRouter.get('/:id/timeline', asyncHandler(async (req: Request, res: Response) => {
  const dispute = disputeService.getDispute(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  res.json({ timeline: dispute.auditTimeline });
}));
