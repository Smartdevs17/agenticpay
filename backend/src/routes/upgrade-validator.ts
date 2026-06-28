import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { getUpgradeValidatorService } from '../services/contracts/upgrade-validator.js';

export const upgradeValidatorRouter = Router();

const validateUpgradeSchema = z.object({
  contractName: z.string().min(1),
  platform: z.enum(['evm', 'soroban']),
  network: z.string().min(1),
  proxyAddress: z.string().min(1),
  newImplementation: z.string().min(1),
  previousImplementation: z.string().optional(),
  deployerAddress: z.string().optional(),
  timelockAddress: z.string().optional(),
  storageLayoutOld: z
    .array(z.object({ name: z.string(), type: z.string(), slot: z.number().int() }))
    .optional(),
  storageLayoutNew: z
    .array(z.object({ name: z.string(), type: z.string(), slot: z.number().int() }))
    .optional(),
});

upgradeValidatorRouter.post(
  '/validate',
  validate(validateUpgradeSchema),
  asyncHandler(async (req, res) => {
    const result = await getUpgradeValidatorService().validateUpgrade(req.body);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json(result.value);
  }),
);

upgradeValidatorRouter.get(
  '/history',
  asyncHandler(async (req, res) => {
    const limit = parseInt(String(req.query.limit ?? '20'), 10);
    const result = await getUpgradeValidatorService().getUpgradeHistory(limit);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json(result.value);
  }),
);

upgradeValidatorRouter.post(
  '/:upgradeId/rollback',
  asyncHandler(async (req, res) => {
    const result = await getUpgradeValidatorService().rollbackUpgrade(req.params.upgradeId);
    if (!result.ok) throw new AppError(result.error.statusCode, result.error.message, result.error.code);
    res.json(result.value);
  }),
);
