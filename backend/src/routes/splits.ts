import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { splitConfigSchema, splitExecutionSchema, splitUpdateSchema } from '../schemas/index.js';
import {
  createSplitConfig,
  executeSplitPayment,
  exportSplitRecipientsCsv,
  getSplitAnalytics,
  getSplitAuditTrail,
  getSplitConfig,
  listMerchantSplits,
  updateSplitConfig,
} from '../services/splits.js';
import { paginateArray } from '../utils/pagination.js';

export const splitsRouter = Router();
const firstParam = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] ?? '' : value ?? '');

splitsRouter.post(
  '/',
  validate(splitConfigSchema),
  asyncHandler(async (req, res) => {
    const created = createSplitConfig(req.body);
    res.status(201).json(created);
  })
);

splitsRouter.get(
  '/merchant/:merchantId',
  asyncHandler(async (req, res) => {
    const merchantId = firstParam(req.params.merchantId);
    if (!merchantId) {
      throw new AppError(400, 'Merchant id is required', 'VALIDATION_ERROR');
    }
    const splits = listMerchantSplits(merchantId);

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

    const paginated = paginateArray(splits, { limit, offset });

    res.json({
      items: paginated.data,
      total: paginated.total,
      limit: paginated.limit,
      offset: paginated.offset,
    });
  })
);

splitsRouter.get(
  '/:splitId',
  asyncHandler(async (req, res) => {
    const splitId = firstParam(req.params.splitId);
    const split = getSplitConfig(splitId);
    if (!split) {
      throw new AppError(404, 'Split config not found', 'NOT_FOUND');
    }
    res.json(split);
  })
);

splitsRouter.patch(
  '/:splitId',
  validate(splitUpdateSchema),
  asyncHandler(async (req, res) => {
    const splitId = firstParam(req.params.splitId);
    const updated = updateSplitConfig(splitId, req.body);
    res.json(updated);
  })
);

splitsRouter.post(
  '/:splitId/execute',
  validate(splitExecutionSchema),
  asyncHandler(async (req, res) => {
    const { paymentId, totalAmount, currency } = req.body;
    const splitId = firstParam(req.params.splitId);
    const result = executeSplitPayment({
      splitId,
      paymentId,
      totalAmount,
      currency,
    });
    res.json(result);
  })
);

splitsRouter.get(
  '/:splitId/analytics',
  asyncHandler(async (req, res) => {
    const splitId = firstParam(req.params.splitId);
    res.json(getSplitAnalytics(splitId));
  })
);

splitsRouter.get(
  '/:splitId/audit',
  asyncHandler(async (req, res) => {
    const splitId = firstParam(req.params.splitId);
    res.json({ events: getSplitAuditTrail(splitId) });
  })
);

splitsRouter.get(
  '/:splitId/recipients/export',
  asyncHandler(async (req, res) => {
    const splitId = firstParam(req.params.splitId);
    const csv = exportSplitRecipientsCsv(splitId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="split-${splitId}-recipients.csv"`);
    res.send(csv);
  })
);
