import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { idempotency } from '../middleware/idempotency.js';
import { cacheControl, CacheTTL } from '../middleware/cache.js';
import {
  mintReceipt,
  batchMintReceipts,
  transferReceipt,
  burnReceipt,
  getReceiptByTokenId,
  getReceiptByPaymentId,
  getReceiptByTxHash,
  getReceiptsByWallet,
  getAllReceipts,
} from '../services/receipts.js';
import {
  mintReceiptSchema,
  batchMintReceiptSchema,
  transferReceiptSchema,
} from '../schemas/receipts.js';

export const receiptsRouter = Router();

receiptsRouter.post(
  '/mint',
  idempotency(),
  validate(mintReceiptSchema),
  asyncHandler(async (req, res) => {
    const receipt = mintReceipt(req.body);
    res.status(201).json(receipt);
  })
);

receiptsRouter.post(
  '/mint/batch',
  idempotency(),
  validate(batchMintReceiptSchema),
  asyncHandler(async (req, res) => {
    const results = batchMintReceipts({ receipts: req.body.receipts });
    res.status(201).json({ receipts: results, count: results.length });
  })
);

receiptsRouter.patch(
  '/:tokenId/transfer',
  validate(transferReceiptSchema),
  asyncHandler(async (req, res) => {
    const { tokenId } = req.params;
    const { newOwner } = req.body as { newOwner: string };
    try {
      const receipt = transferReceipt(tokenId, newOwner);
      res.json(receipt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transfer failed';
      throw new AppError(400, msg, 'TRANSFER_FAILED');
    }
  })
);

receiptsRouter.delete(
  '/:tokenId/burn',
  asyncHandler(async (req, res) => {
    const { tokenId } = req.params;
    try {
      const receipt = burnReceipt(tokenId);
      res.json({ message: 'Receipt burned', receipt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Burn failed';
      throw new AppError(400, msg, 'BURN_FAILED');
    }
  })
);

receiptsRouter.get(
  '/',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const includeBurned = req.query.includeBurned === 'true';
    res.json(getAllReceipts(includeBurned));
  })
);

receiptsRouter.get(
  '/by-payment/:paymentId',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const receipt = getReceiptByPaymentId(req.params.paymentId);
    if (!receipt) throw new AppError(404, 'Receipt not found', 'NOT_FOUND');
    res.json(receipt);
  })
);

receiptsRouter.get(
  '/by-tx/:txHash',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const receipt = getReceiptByTxHash(req.params.txHash);
    if (!receipt) throw new AppError(404, 'Receipt not found', 'NOT_FOUND');
    res.json(receipt);
  })
);

receiptsRouter.get(
  '/by-wallet/:walletAddress',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    res.json(getReceiptsByWallet(req.params.walletAddress));
  })
);

receiptsRouter.get(
  '/:tokenId',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const receipt = getReceiptByTokenId(req.params.tokenId);
    if (!receipt) throw new AppError(404, 'Receipt not found', 'NOT_FOUND');
    res.json(receipt);
  })
);

receiptsRouter.get(
  '/:tokenId/metadata',
  cacheControl({ maxAge: CacheTTL.LONG }),
  asyncHandler(async (req, res) => {
    const receipt = getReceiptByTokenId(req.params.tokenId);
    if (!receipt) throw new AppError(404, 'Receipt not found', 'NOT_FOUND');
    res.json(receipt.metadata);
  })
);
