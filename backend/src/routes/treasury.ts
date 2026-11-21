import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { treasuryService } from '../services/treasury/treasury.service.js';
import { AppError } from '../middleware/errorHandler.js';

export const treasuryRouter = Router();

function resolveTenant(req: any): string {
  return (req.headers['x-tenant-id'] as string) ?? 'default';
}

treasuryRouter.post('/proposals', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const proposal = await treasuryService.propose({ ...req.body, tenantId });
  res.status(201).json(proposal);
}));

treasuryRouter.get('/proposals', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const { status, limit } = req.query as any;
  const proposals = await treasuryService.listProposals(tenantId, {
    status,
    limit: limit ? parseInt(limit) : undefined,
  });
  res.json({ proposals });
}));

treasuryRouter.get('/proposals/:id', asyncHandler(async (req, res) => {
  const proposal = await treasuryService.getProposal(req.params.id);
  res.json(proposal);
}));

treasuryRouter.post('/proposals/:id/approve', asyncHandler(async (req, res) => {
  const { signer } = req.body as { signer: string };
  if (!signer) throw new AppError(400, 'Signer address required', 'MISSING_SIGNER');
  const proposal = await treasuryService.approve(req.params.id, signer);
  res.json(proposal);
}));

treasuryRouter.post('/proposals/:id/reject', asyncHandler(async (req, res) => {
  const { signer } = req.body as { signer: string };
  if (!signer) throw new AppError(400, 'Signer address required', 'MISSING_SIGNER');
  const proposal = await treasuryService.reject(req.params.id, signer);
  res.json(proposal);
}));

treasuryRouter.post('/proposals/:id/execute', asyncHandler(async (req, res) => {
  const { executedBy, txHash } = req.body as { executedBy: string; txHash?: string };
  if (!executedBy) throw new AppError(400, 'Executor address required', 'MISSING_EXECUTOR');
  const execution = await treasuryService.execute(req.params.id, executedBy, txHash);
  res.json(execution);
}));

treasuryRouter.post('/proposals/:id/cancel', asyncHandler(async (req, res) => {
  const { caller } = req.body as { caller: string };
  if (!caller) throw new AppError(400, 'Caller address required', 'MISSING_CALLER');
  const proposal = await treasuryService.cancel(req.params.id, caller);
  res.json(proposal);
}));
