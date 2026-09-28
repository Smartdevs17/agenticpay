// Issue #921: KYC onboarding API.
//
// Applicant flow: personal info → document upload (validated locally, then
// checked by the verification provider) → submit for review → status.
// Reviewer endpoints cover the manual review queue and decisions.

import { Router, type RequestHandler } from 'express';
import { validate } from '../middleware/validate.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { KycError, kycService } from '../services/kyc.js';
import {
  ADDRESS_DOCUMENT_TYPES,
  EXPIRY_WARNING_DAYS,
  IDENTITY_DOCUMENT_TYPES,
  KYC_ALLOWED_MIME_TYPES,
  KYC_MAX_FILE_BYTES,
  KYC_MIN_FILE_BYTES,
  MINIMUM_AGE,
  PROOF_OF_ADDRESS_MAX_AGE_DAYS,
} from '../services/kyc-verification.js';
import {
  kycDocumentReviewSchema,
  kycDocumentUploadSchema,
  kycPersonalInfoSchema,
  kycReviewSchema,
} from '../schemas/kyc.js';

export const kycRouter = Router();

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

// Maps service errors onto the API error envelope.
function kycHandler(handler: Parameters<typeof asyncHandler>[0]): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      if (error instanceof KycError) {
        throw new AppError(error.statusCode, error.message, error.code, error.details);
      }
      throw error;
    }
  });
}

// Document rules for building the upload step client-side
kycRouter.get(
  '/requirements',
  kycHandler(async (_req, res) => {
    res.json({
      identityDocumentTypes: IDENTITY_DOCUMENT_TYPES,
      addressDocumentTypes: ADDRESS_DOCUMENT_TYPES,
      allowedMimeTypes: KYC_ALLOWED_MIME_TYPES,
      maxFileBytes: KYC_MAX_FILE_BYTES,
      minFileBytes: KYC_MIN_FILE_BYTES,
      proofOfAddressMaxAgeDays: PROOF_OF_ADDRESS_MAX_AGE_DAYS,
      expiryWarningDays: EXPIRY_WARNING_DAYS,
      minimumAge: MINIMUM_AGE,
    });
  })
);

// Manual review queue
kycRouter.get(
  '/review/queue',
  kycHandler(async (_req, res) => {
    res.json({ items: kycService.listForReview() });
  })
);

// Onboarding state for an applicant
kycRouter.get(
  '/:userId',
  kycHandler(async (req, res) => {
    const state = kycService.getOnboardingState(param(req.params.userId));
    if (!state) throw new AppError(404, 'KYC profile not found', 'KYC_NOT_FOUND');
    res.json(state);
  })
);

// Step 1: personal information
kycRouter.put(
  '/:userId/personal-info',
  validate(kycPersonalInfoSchema),
  kycHandler(async (req, res) => {
    const userId = param(req.params.userId);
    kycService.savePersonalInfo(userId, req.body);
    res.json(kycService.getOnboardingState(userId));
  })
);

// Step 2: document upload and verification
kycRouter.post(
  '/:userId/documents',
  validate(kycDocumentUploadSchema),
  kycHandler(async (req, res) => {
    const userId = param(req.params.userId);
    const document = await kycService.uploadDocument(userId, req.body);
    res.status(201).json({ document, state: kycService.getOnboardingState(userId) });
  })
);

// Step 3: submit for review
kycRouter.post(
  '/:userId/submit',
  kycHandler(async (req, res) => {
    const userId = param(req.params.userId);
    kycService.submitForReview(userId);
    res.json(kycService.getOnboardingState(userId));
  })
);

// Reviewer decision on a single document
kycRouter.post(
  '/:userId/documents/:documentId/review',
  validate(kycDocumentReviewSchema),
  kycHandler(async (req, res) => {
    const { approved, reasons } = req.body;
    const document = kycService.reviewDocument(
      param(req.params.userId),
      param(req.params.documentId),
      approved,
      reasons,
    );
    res.json(document);
  })
);

// Reviewer decision on the application
kycRouter.post(
  '/:userId/review',
  validate(kycReviewSchema),
  kycHandler(async (req, res) => {
    const userId = param(req.params.userId);
    kycService.review(userId, req.body);
    res.json(kycService.getOnboardingState(userId));
  })
);
