import { Router, type Request, type Response, type NextFunction } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { secureFileUpload, secureUrlUpload, runRetentionCleanup } from '../middleware/file-upload.js';
import type { UploadCategory, UploadedFile } from '../middleware/file-upload.js';

export const fileUploadRouter = Router();

// Extend Request type locally
interface UploadRequest {
  uploadedFile: UploadedFile;
}

const VALID_CATEGORIES: UploadCategory[] = ['kyc', 'dispute', 'general'];

function validateCategory(req: Request, _res: Response, next: NextFunction): void {
  const category = req.params.category as UploadCategory;
  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(
      400,
      `Invalid upload category. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
      'VALIDATION_ERROR',
    );
  }
  next();
}

function respondWithUploadedFile(req: Request, res: Response): Response {
  const { uploadedFile } = req as Request & UploadRequest;
  return res.status(201).json({
    id: uploadedFile.id,
    originalName: uploadedFile.originalName,
    mimeType: uploadedFile.mimeType,
    size: uploadedFile.size,
    sha256: uploadedFile.sha256,
    category: uploadedFile.category,
    storedAt: uploadedFile.storedAt,
  });
}

// Remote upload by URL — SSRF-hardened fetch then the same storage + validation
// pipeline as a multipart upload (Issue #1476).
fileUploadRouter.post(
  '/:category/url',
  validateCategory,
  (req, res, next) => secureUrlUpload({ category: req.params.category as UploadCategory })(req, res, next),
  asyncHandler(async (req, res) => respondWithUploadedFile(req, res)),
);

// Multipart upload (Issue #401).
fileUploadRouter.post(
  '/:category',
  validateCategory,
  (req, res, next) => secureFileUpload({ category: req.params.category as UploadCategory })(req, res, next),
  asyncHandler(async (req, res) => respondWithUploadedFile(req, res)),
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
