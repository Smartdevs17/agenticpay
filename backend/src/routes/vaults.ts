import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  createVaultSchema,
  approveMilestoneSchema,
  releaseMilestoneSchema,
  recordDeploymentSchema,
  resolveDisputeSchema,
} from '../schemas/vaults.js';
import { vaultService } from '../services/vaults/vault.service.js';

export const vaultsRouter = Router();

function getTenantId(req: Parameters<Parameters<typeof vaultsRouter.use>[0]>[0]): string {
  return (req.headers['x-tenant-id'] as string | undefined) ?? 'default';
}

vaultsRouter.post(
  '/',
  validate(createVaultSchema),
  asyncHandler(async (req, res) => {
    const tenantId = getTenantId(req);
    const body = req.body as {
      depositorAddress: string; recipientAddress: string; totalAmount: number;
      currency: string; network: string;
      milestones: Array<{ name: string; amountPercent: number; deadline: string; approverAddress: string }>;
    };
    const result = await vaultService.createVault(
      { ...body, milestones: body.milestones.map((m) => ({ ...m, deadline: new Date(m.deadline) })) },
      tenantId,
    );
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.status(201).json({ data: result.value, timestamp: new Date() });
  }),
);

vaultsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const tenantId = getTenantId(req);
    const filters = {
      status: req.query.status as string | undefined,
      depositorAddress: req.query.depositorAddress as string | undefined,
    };
    const result = await vaultService.listVaults(tenantId, filters);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json({ data: result.value, timestamp: new Date() });
  }),
);

vaultsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const tenantId = getTenantId(req);
    const result = await vaultService.getVault(req.params.id, tenantId);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json({ data: result.value, timestamp: new Date() });
  }),
);

vaultsRouter.post(
  '/:id/deploy',
  validate(recordDeploymentSchema),
  asyncHandler(async (req, res) => {
    const tenantId = getTenantId(req);
    const { contractAddress, contractVaultId } = req.body as { contractAddress: string; contractVaultId: string };
    const result = await vaultService.recordContractDeployment(req.params.id, tenantId, contractAddress, contractVaultId);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json({ data: result.value, timestamp: new Date() });
  }),
);

vaultsRouter.post(
  '/:id/dispute',
  asyncHandler(async (req, res) => {
    const tenantId = getTenantId(req);
    const raisedBy = (req.body as { raisedBy?: string }).raisedBy ?? 'unknown';
    const result = await vaultService.raiseDispute(req.params.id, raisedBy, tenantId);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json({ data: result.value, timestamp: new Date() });
  }),
);

vaultsRouter.post(
  '/:id/resolve',
  validate(resolveDisputeSchema),
  asyncHandler(async (req, res) => {
    const tenantId = getTenantId(req);
    const { resolution } = req.body as { resolution: 'release' | 'refund' };
    const result = await vaultService.resolveDispute(req.params.id, resolution, tenantId);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json({ data: result.value, timestamp: new Date() });
  }),
);

vaultsRouter.post(
  '/milestones/:milestoneId/approve',
  validate(approveMilestoneSchema),
  asyncHandler(async (req, res) => {
    const { approverAddress } = req.body as { approverAddress: string };
    const result = await vaultService.approveMilestone(req.params.milestoneId, approverAddress);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json({ data: result.value, timestamp: new Date() });
  }),
);

vaultsRouter.post(
  '/milestones/:milestoneId/release',
  validate(releaseMilestoneSchema),
  asyncHandler(async (req, res) => {
    const { txHash, triggeredBy } = req.body as { txHash?: string; triggeredBy: string };
    const result = await vaultService.releaseMilestone(req.params.milestoneId, txHash, triggeredBy);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json({ data: result.value, timestamp: new Date() });
  }),
);
