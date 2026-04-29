import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { cacheControl, CacheTTL } from '../middleware/cache.js';
import {
  submitKYB,
  getKYB,
  getKYBByBusinessId,
  listKYBForReview,
  updateKYBStatus,
  renewKYB,
  getKYBAnalytics,
} from '../services/kyb.js';
import { kybSubmitSchema, kybReviewSchema, kybRenewalSchema } from '../schemas/kyb.js';

export const kybRouter = Router();

// Submit KYB application
kybRouter.post(
  '/submit',
  validate(kybSubmitSchema),
  asyncHandler(async (req, res) => {
    const record = submitKYB(req.body);
    res.status(201).json(record);
  })
);

// Get KYB status by record ID
kybRouter.get(
  '/:id',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const record = getKYB(id);
    if (!record) throw new AppError(404, 'KYB record not found', 'NOT_FOUND');
    res.json(record);
  })
);

// Get KYB status by business ID
kybRouter.get(
  '/business/:businessId',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const businessId = Array.isArray(req.params.businessId) ? req.params.businessId[0] : req.params.businessId;
    const record = getKYBByBusinessId(businessId);
    if (!record) throw new AppError(404, 'KYB record not found for business', 'NOT_FOUND');
    res.json(record);
  })
);

// Manual review queue — list all pending/under-review applications
kybRouter.get(
  '/review/queue',
  asyncHandler(async (_req, res) => {
    res.json({ items: listKYBForReview() });
  })
);

// Submit manual review decision
kybRouter.post(
  '/:id/review',
  validate(kybReviewSchema),
  asyncHandler(async (req, res) => {
    const { decision, reviewerNotes, requestedDocuments } = req.body;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const current = getKYB(id);
    if (!current) throw new AppError(404, 'KYB record not found', 'NOT_FOUND');

    const statusMap: Record<string, 'approved' | 'rejected' | 'requires_more_info'> = {
      approved: 'approved',
      rejected: 'rejected',
      requires_more_info: 'requires_more_info',
    };

    const updated = updateKYBStatus(id, statusMap[decision], reviewerNotes, requestedDocuments);
    res.json(updated);
  })
);

// Renewal workflow
kybRouter.post(
  '/:id/renew',
  validate(kybRenewalSchema),
  asyncHandler(async (req, res) => {
    const { documents, notes } = req.body;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = renewKYB(id, documents, notes);
    if (!updated) throw new AppError(404, 'KYB record not found', 'NOT_FOUND');
    res.json(updated);
  })
);

// KYB analytics
kybRouter.get(
  '/analytics/summary',
  asyncHandler(async (_req, res) => {
    res.json(getKYBAnalytics());
  })
);
