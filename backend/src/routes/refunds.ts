import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { refundEvaluationSchema, refundPolicySchema } from '../schemas/index.js';
import {
  evaluateRefund,
  getRefundAnalytics,
  getRefundPolicy,
  listManualReviews,
  resolveManualReview,
  upsertRefundPolicy,
} from '../services/refunds.js';
import { paginateArray } from '../utils/pagination.js';

export const refundsRouter = Router();
const firstParam = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] ?? '' : value ?? '');

refundsRouter.post(
  '/policies',
  validate(refundPolicySchema),
  asyncHandler(async (req, res) => {
    const policy = upsertRefundPolicy(req.body);
    res.status(201).json(policy);
  })
);

refundsRouter.get(
  '/policies/:merchantId',
  asyncHandler(async (req, res) => {
    const merchantId = firstParam(req.params.merchantId);
    if (!merchantId) {
      throw new AppError(400, 'Merchant id is required', 'VALIDATION_ERROR');
    }
    res.json(getRefundPolicy(merchantId));
  })
);

refundsRouter.post(
  '/evaluate',
  validate(refundEvaluationSchema),
  asyncHandler(async (req, res) => {
    res.json(evaluateRefund(req.body));
  })
);

refundsRouter.get(
  '/manual-review',
  asyncHandler(async (req, res) => {
    const merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
    const reviews = listManualReviews(merchantId);

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

    const paginated = paginateArray(reviews, { limit, offset });

    res.json({
      items: paginated.data,
      total: paginated.total,
      limit: paginated.limit,
      offset: paginated.offset,
    });
  })
);

refundsRouter.patch(
  '/manual-review/:reviewId',
  asyncHandler(async (req, res) => {
    const reviewId = firstParam(req.params.reviewId);
    const status = req.body?.status;
    if (status !== 'approved' && status !== 'rejected') {
      throw new AppError(400, "Status must be 'approved' or 'rejected'", 'VALIDATION_ERROR');
    }
    res.json(resolveManualReview(reviewId, status));
  })
);

refundsRouter.get(
  '/analytics/:merchantId',
  asyncHandler(async (req, res) => {
    const merchantId = firstParam(req.params.merchantId);
    res.json(getRefundAnalytics(merchantId));
  })
);
