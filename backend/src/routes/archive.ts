/**
 * Soft delete / archive administration routes — Issue #884
 *
 * GET  /api/v1/archive/records         — list archived rows
 * POST /api/v1/archive/sweep           — archive soft-deleted rows past retention
 * POST /api/v1/archive/:model/:id/restore — restore an archived row
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError, NotFoundError } from '../types/errors';
import {
  ARCHIVABLE_MODELS,
  ArchivableModel,
  archiveExpiredSoftDeletesForAllModels,
  listArchivedRecords,
  restoreFromArchive,
} from '../services/archive/soft-delete-archive.service.js';

export const archiveRouter = Router();

function isArchivableModel(value: string): value is ArchivableModel {
  return (ARCHIVABLE_MODELS as readonly string[]).includes(value);
}

archiveRouter.get(
  '/records',
  asyncHandler(async (req: Request, res: Response) => {
    const { model, tenantId, cursor } = req.query;
    if (typeof model === 'string' && !isArchivableModel(model)) {
      throw new ValidationError(`Unknown archivable model: ${model}`);
    }

    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const records = await listArchivedRecords({
      model: typeof model === 'string' ? model : undefined,
      tenantId: typeof tenantId === 'string' ? tenantId : undefined,
      cursor: typeof cursor === 'string' ? cursor : undefined,
      limit,
    });

    res.json({ data: records });
  }),
);

archiveRouter.post(
  '/sweep',
  asyncHandler(async (req: Request, res: Response) => {
    const retentionDays = req.body?.retentionDays ? Number(req.body.retentionDays) : undefined;
    const results = await archiveExpiredSoftDeletesForAllModels({ retentionDays });
    res.json({ data: results });
  }),
);

archiveRouter.post(
  '/:model/:id/restore',
  asyncHandler(async (req: Request, res: Response) => {
    const { model, id } = req.params;
    if (!isArchivableModel(model)) {
      throw new ValidationError(`Unknown archivable model: ${model}`);
    }

    try {
      await restoreFromArchive(model, id);
    } catch (err) {
      throw new NotFoundError(err instanceof Error ? err.message : 'Archived record not found');
    }

    res.json({ data: { model, id, restored: true } });
  }),
);
