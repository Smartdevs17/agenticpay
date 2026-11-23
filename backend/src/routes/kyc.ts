// Issue #921: KYC onboarding API.
//
// Applicant flow: personal info → document upload (validated locally, then
// checked by the verification provider) → submit for review → status.
// Reviewer endpoints cover the manual review queue and decisions.

import { Router, type Request, type RequestHandler } from 'express';
import { authMiddleware } from '../middleware/auth.js';
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

/** Tenant whose key encrypts the applicant's documents (#1470). */
function applicantTenant(req: Request): string {
  return req.user?.tenantId ?? req.get('x-tenant-id') ?? 'default';
}

/** Roles allowed to read decrypted KYC documents. */
export const KYC_DOCUMENT_READER_ROLES = ['admin', 'owner', 'compliance'];

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
    kycService.savePersonalInfo(userId, req.body, applicantTenant(req));
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

// Reviewer download of an uploaded file, decrypted from the vault (#1470).
// Authenticated, role-checked, scoped to the reviewer's own tenant and audited.
kycRouter.get(
  '/:userId/documents/:documentId/content',
  authMiddleware,
  kycHandler(async (req, res) => {
    const principal = req.user!;
    if (!KYC_DOCUMENT_READER_ROLES.includes(principal.role)) {
      throw new AppError(403, 'Not allowed to read KYC documents', 'FORBIDDEN');
    }
    const reason = req.get('x-access-reason') ?? undefined;
    const { document, content } = await kycService.readDocumentContent(
      param(req.params.userId),
      param(req.params.documentId),
      { tenantId: principal.tenantId, actor: principal.id, reason },
    );
    res.setHeader('Content-Type', document.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(content.length));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(document.fileName ?? document.id)}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(content);
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
