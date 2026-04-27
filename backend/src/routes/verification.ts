import { Router } from 'express';
import {
  verifyWork,
  getVerification,
  updateVerification,
  deleteVerification,
} from '../services/verification.js';
import { idempotency } from '../middleware/idempotency.js';
import { validate } from '../middleware/validate.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import {
  verificationSchema,
  bulkVerificationSchema,
  bulkUpdateSchema,
  bulkDeleteSchema,
} from '../schemas/index.js';
import { cacheControl, CacheTTL } from '../middleware/cache.js';

export const verificationRouter = Router();

// AI-powered work verification
verificationRouter.post(
  '/verify',
  idempotency(),
  validate(verificationSchema),
  asyncHandler(async (req, res) => {
    const { repositoryUrl, milestoneDescription, projectId } = req.body;

    if (!repositoryUrl || !milestoneDescription || !projectId) {
      throw new AppError(400, 'Missing required fields', 'VALIDATION_ERROR');
    }

    const result = await verifyWork({ repositoryUrl, milestoneDescription, projectId });
    res.json(result);
  })
);

// Bulk AI-powered work verification
verificationRouter.post(
  '/verify/batch',
  idempotency(),
  validate(bulkVerificationSchema),
  asyncHandler(async (req, res) => {
    const { items } = req.body as {
      items?: Array<{ repositoryUrl?: string; milestoneDescription?: string; projectId?: string }>;
    };

    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError(400, 'Missing items for bulk verification', 'VALIDATION_ERROR');
    }

    const results = await Promise.all(
      items.map(async (item, index) => {
        if (!item?.repositoryUrl || !item?.milestoneDescription || !item?.projectId) {
          return { index, status: 'error', error: 'Missing required fields' };
        }

        try {
          const data = await verifyWork({
            repositoryUrl: item.repositoryUrl,
            milestoneDescription: item.milestoneDescription,
            projectId: item.projectId,
          });
          return { index, status: 'success', data };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Verification failed';
          return { index, status: 'error', error: message };
        }
      })
    );

    res.json({ results });
  })
);

// Bulk update verification results
verificationRouter.patch(
  '/batch',
  validate(bulkUpdateSchema),
  asyncHandler(async (req, res) => {
    const { items } = req.body as {
      items?: Array<{
        id?: string;
        status?: 'passed' | 'failed' | 'pending';
        score?: number;
        summary?: string;
        details?: string[];
      }>;
    };

    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError(400, 'Missing items for bulk update', 'VALIDATION_ERROR');
    }

    const results = items.map((item, index) => {
      if (!item?.id) {
        return { index, status: 'error', error: 'Missing verification id' };
      }

      const hasUpdates =
        item.status !== undefined ||
        item.score !== undefined ||
        item.summary !== undefined ||
        item.details !== undefined;

      if (!hasUpdates) {
        return { index, status: 'error', error: 'No update fields provided' };
      }

      const updated = updateVerification({
        id: item.id,
        status: item.status,
        score: item.score,
        summary: item.summary,
        details: item.details,
      });

      if (!updated) {
        return { index, status: 'error', error: 'Verification not found' };
      }

      return { index, status: 'success', data: updated };
    });

    const updatedCount = results.filter((result) => result.status === 'success').length;
    res.json({ results, updatedCount });
  })
);

// Bulk delete verification results
verificationRouter.delete(
  '/batch',
  validate(bulkDeleteSchema),
  asyncHandler(async (req, res) => {
    const { ids } = req.body as { ids?: string[] };

    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError(400, 'Missing ids for bulk delete', 'VALIDATION_ERROR');
    }

    const results = ids.map((id) => {
      if (!id) {
        return { id, status: 'error', error: 'Missing verification id' };
      }

      const deleted = deleteVerification(id);
      return deleted ? { id, status: 'deleted' } : { id, status: 'not_found' };
    });

    const deletedCount = results.filter((result) => result.status === 'deleted').length;
    res.json({ results, deletedCount });
  })
);

// Get verification result by ID — cache for 30 s (result may still be updated)
verificationRouter.get(
  '/:id',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await getVerification(id);
    if (!result) {
      throw new AppError(404, 'Verification not found', 'NOT_FOUND');
    }
    res.json(result);
  })
);
