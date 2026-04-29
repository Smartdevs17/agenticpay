import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import {
  createOffchainTransfer,
  getEmergencyHalt,
  listTokenizationState,
  redeemTokens,
  requestMint,
  setEmergencyHalt,
  settleBatch,
  updateOracle,
} from '../services/tokenization.js';

export const tokenizationRouter = Router();

const mintSchema = z.object({
  accountId: z.string().min(1),
  currency: z.string().min(3).max(5),
  amount: z.number().positive(),
  collateralRatio: z.number().positive(),
  kycVerified: z.boolean(),
  amlVerified: z.boolean(),
});

const transferSchema = z.object({
  token: z.string().min(3),
  from: z.string().min(1),
  to: z.string().min(1),
  amount: z.number().positive(),
  nonce: z.string().min(1),
  signature: z.string().min(10),
});

const settleSchema = z.object({
  token: z.string().min(3),
  limit: z.number().int().positive().max(500).optional(),
});

const redeemSchema = z.object({
  accountId: z.string().min(1),
  token: z.string().min(3),
  amount: z.number().positive(),
});

const oracleSchema = z.object({
  currency: z.string().min(3).max(5),
  collateralLocked: z.number().nonnegative(),
  tokenSupply: z.number().nonnegative(),
});

const haltSchema = z.object({
  enabled: z.boolean(),
});

tokenizationRouter.post(
  '/mint',
  validate(mintSchema),
  asyncHandler(async (req, res) => {
    const mint = requestMint(req.body);
    res.status(201).json(mint);
  })
);

tokenizationRouter.post(
  '/offchain-transfer',
  validate(transferSchema),
  asyncHandler(async (req, res) => {
    try {
      const transfer = createOffchainTransfer(req.body);
      res.status(201).json(transfer);
    } catch (error) {
      throw new AppError(400, error instanceof Error ? error.message : String(error), 'TOKENIZATION_REJECTED');
    }
  })
);

tokenizationRouter.post(
  '/settle-batch',
  validate(settleSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(settleBatch(req.body.token, req.body.limit));
  })
);

tokenizationRouter.post(
  '/redeem',
  validate(redeemSchema),
  asyncHandler(async (req, res) => {
    res.status(202).json(redeemTokens(req.body));
  })
);

tokenizationRouter.post(
  '/oracle',
  validate(oracleSchema),
  asyncHandler(async (req, res) => {
    const { currency, collateralLocked, tokenSupply } = req.body;
    res.json(updateOracle(currency, collateralLocked, tokenSupply));
  })
);

tokenizationRouter.post(
  '/halt',
  validate(haltSchema),
  asyncHandler(async (req, res) => {
    res.json(setEmergencyHalt(req.body.enabled));
  })
);

tokenizationRouter.get(
  '/halt',
  asyncHandler(async (_req, res) => {
    res.json(getEmergencyHalt());
  })
);

tokenizationRouter.get(
  '/state',
  asyncHandler(async (_req, res) => {
    res.json(listTokenizationState());
  })
);
