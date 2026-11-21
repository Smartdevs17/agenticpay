import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { secureFileUpload, runRetentionCleanup } from '../middleware/file-upload.js';
import type { UploadCategory, UploadedFile } from '../middleware/file-upload.js';

export const fileUploadRouter = Router();

// Extend Request type locally
interface UploadRequest {
  uploadedFile: UploadedFile;
}

const VALID_CATEGORIES: UploadCategory[] = ['kyc', 'dispute', 'general'];

fileUploadRouter.post(
  '/:category',
  (req, res, next) => {
    const category = req.params.category as UploadCategory;
    if (!VALID_CATEGORIES.includes(category)) {
      throw new AppError(400, `Invalid upload category. Must be one of: ${VALID_CATEGORIES.join(', ')}`, 'VALIDATION_ERROR');
    }
    return secureFileUpload({ category })(req, res, next);
  },
  asyncHandler(async (req, res) => {
    const { uploadedFile } = req as typeof req & UploadRequest;
    return res.status(201).json({
      id: uploadedFile.id,
      originalName: uploadedFile.originalName,
      mimeType: uploadedFile.mimeType,
      size: uploadedFile.size,
      sha256: uploadedFile.sha256,
      category: uploadedFile.category,
      storedAt: uploadedFile.storedAt,
    });
  }),
);

fileUploadRouter.post(
  '/admin/cleanup',
  asyncHandler(async (req, res) => {
    const { acceptedRetentionDays, quarantineRetentionDays } = req.body as {
      acceptedRetentionDays?: number;
      quarantineRetentionDays?: number;
    };

    const result = await runRetentionCleanup({ acceptedRetentionDays, quarantineRetentionDays });
    return res.json(result);
  }),
);
