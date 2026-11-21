import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KycError, KycService, canTransition, type KycPersonalInfo } from '../kyc.js';
import type {
  DocumentVerificationProvider,
  DocumentVerificationRequest,
  KycDocumentInput,
} from '../kyc-verification.js';

const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2048, 0x20)]);

const person: KycPersonalInfo = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: '1990-04-12',
  nationality: 'gb',
  countryOfResidence: 'GB',
  address: { line1: '1 Main St', city: 'London', postalCode: 'N1 9GU', country: 'gb' },
};

function passport(overrides: Partial<KycDocumentInput> = {}): KycDocumentInput {
  return {
    type: 'passport',
    documentNumber: '123456789',
    issuingCountry: 'GB',
    expiryDate: '2031-01-01',
    fileName: 'passport.pdf',
    mimeType: 'application/pdf',
    fileSize: pdf.length,
    fileContent: pdf.toString('base64'),
    ...overrides,
  };
}

function bankStatement(overrides: Partial<KycDocumentInput> = {}): KycDocumentInput {
  return {
    type: 'bank_statement',
    issuingCountry: 'GB',
    issueDate: '2026-06-01',
    fileName: 'statement.pdf',
    mimeType: 'application/pdf',
    fileSize: pdf.length,
    fileContent: pdf.toString('base64'),
    ...overrides,
  };
}

async function expectKycError(promise: Promise<unknown> | (() => unknown), code: string, statusCode: number) {
  let error: unknown;
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(KycError);
  expect((error as KycError).code).toBe(code);
  expect((error as KycError).statusCode).toBe(statusCode);
  return error as KycError;
}

describe('KYC onboarding flow', () => {
  let service: KycService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
    service = new KycService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('canTransition', () => {
    it('allows only the documented status transitions', () => {
      expect(canTransition('pending', 'under_review')).toBe(true);
      expect(canTransition('under_review', 'approved')).toBe(true);
      expect(canTransition('under_review', 'rejected')).toBe(true);
      expect(canTransition('rejected', 'pending')).toBe(true);
      expect(canTransition('approved', 'expired')).toBe(true);

      expect(canTransition('pending', 'approved')).toBe(false);
      expect(canTransition('rejected', 'approved')).toBe(false);
      expect(canTransition('approved', 'pending')).toBe(false);
    });
  });

  describe('savePersonalInfo', () => {
    it('creates a pending profile and advances to the documents step', () => {
      const profile = service.savePersonalInfo('user-1', person);

      expect(profile.status).toBe('pending');
      expect(profile.onboardingStep).toBe('documents');
      expect(profile.personalInfo?.nationality).toBe('GB');
      expect(profile.personalInfo?.address.country).toBe('GB');
      expect(profile.statusHistory).toEqual([
        expect.objectContaining({ from: null, to: 'pending', actor: 'user-1', reason: 'Onboarding started' }),
      ]);
    });

    it('rejects underage applicants', async () => {
      const error = await expectKycError(
        () => service.savePersonalInfo('user-1', { ...person, dateOfBirth: '2010-01-01' }),
        'INVALID_PERSONAL_INFO',
        422,
      );
      expect(error.details).toEqual(['Applicant must be at least 18 years old']);
      expect(service.getProfile('user-1')).toBeUndefined();
    });

    it('locks personal info while the application is under review', async () => {
      service = new KycService({ autoApprove: false });
      service.savePersonalInfo('user-1', person);
      await service.uploadDocument('user-1', passport());
      await service.uploadDocument('user-1', bankStatement());
      service.submitForReview('user-1');

      await expectKycError(() => service.savePersonalInfo('user-1', person), 'KYC_LOCKED', 409);
    });
  });

  describe('uploadDocument', () => {
    it('requires personal info first', async () => {
      await expectKycError(service.uploadDocument('user-1', passport()), 'PERSONAL_INFO_REQUIRED', 409);
    });

    it('stores verified document metadata without the raw number or contents', async () => {
      service.savePersonalInfo('user-1', person);
      const doc = await service.uploadDocument('user-1', passport());

      expect(doc.status).toBe('approved');
      expect(doc.verified).toBe(true);
      expect(doc.documentNumberMasked).toBe('*****6789');
      expect(doc.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(doc.verification).toEqual(
        expect.objectContaining({ provider: 'mock', decision: 'approved', confidence: 0.95 }),
      );
      expect(JSON.stringify(doc)).not.toContain('123456789');
      expect(JSON.stringify(doc)).not.toContain(pdf.toString('base64'));
    });

    it('returns validation reasons for invalid documents', async () => {
      service.savePersonalInfo('user-1', person);
      const error = await expectKycError(
        service.uploadDocument('user-1', passport({ expiryDate: '2026-01-01' })),
        'INVALID_DOCUMENT',
        422,
      );
      expect(error.details).toEqual(['Document expired on 2026-01-01']);
      expect(service.getProfile('user-1')!.documents).toHaveLength(0);
    });

    it('records provider rejections with reasons', async () => {
      service.savePersonalInfo('user-1', person);
      const doc = await service.uploadDocument('user-1', passport({ documentNumber: '123456000' }));

      expect(doc.status).toBe('rejected');
      expect(doc.rejectionReasons).toEqual(['Document number is reported as lost or stolen']);
      expect(service.getOnboardingState('user-1')!.requirements[0].satisfied).toBe(false);
    });

    it('keeps inconclusive documents pending with a warning', async () => {
      service.savePersonalInfo('user-1', person);
      const doc = await service.uploadDocument('user-1', passport({ documentNumber: '123456999' }));

      expect(doc.status).toBe('pending');
      expect(doc.warnings).toContain('Automated checks were inconclusive; manual review required');
    });

    it('falls back to manual review when the provider fails', async () => {
      const failing: DocumentVerificationProvider = {
        name: 'failing',
        verify: vi.fn().mockRejectedValue(new Error('timeout')),
      };
      service = new KycService({ verificationProvider: failing });
      service.savePersonalInfo('user-1', person);
      const doc = await service.uploadDocument('user-1', passport());

      expect(doc.status).toBe('pending');
      expect(doc.verification?.provider).toBe('failing');
      expect(doc.warnings).toContain('Verification provider unavailable; document queued for manual review');
    });

    it('passes the decoded file and applicant details to the provider', async () => {
      const verify = vi.fn(async (_req: DocumentVerificationRequest) => ({
        decision: 'approved' as const,
        reasons: [],
        confidence: 1,
        reference: 'ref-1',
      }));
      service = new KycService({ verificationProvider: { name: 'custom', verify } });
      service.savePersonalInfo('user-1', person);
      await service.uploadDocument('user-1', passport({ documentNumber: '1234 56789' }));

      const request = verify.mock.calls[0][0];
      expect(request.documentNumber).toBe('123456789');
      expect(request.file?.equals(pdf)).toBe(true);
      expect(request.personalInfo?.lastName).toBe('Lovelace');
    });

    it('replaces an earlier upload of the same document type', async () => {
      service.savePersonalInfo('user-1', person);
      await service.uploadDocument('user-1', passport({ documentNumber: '123456000' }));
      const replacement = await service.uploadDocument('user-1', passport());

      const documents = service.getProfile('user-1')!.documents;
      expect(documents).toHaveLength(1);
      expect(documents[0].id).toBe(replacement.id);
      expect(documents[0].status).toBe('approved');
    });

    it('prevents one identity document from being used by two accounts', async () => {
      service.savePersonalInfo('user-1', person);
      service.savePersonalInfo('user-2', person);
      await service.uploadDocument('user-1', passport());

      const error = await expectKycError(service.uploadDocument('user-2', passport()), 'DUPLICATE_DOCUMENT', 409);
      expect(error.details).toEqual(['This document is already linked to another account']);
    });
  });

  describe('submitForReview', () => {
    it('refuses to submit until every requirement is met', async () => {
      service.savePersonalInfo('user-1', person);
      await service.uploadDocument('user-1', passport());

      const error = await expectKycError(() => service.submitForReview('user-1'), 'REQUIREMENTS_NOT_MET', 422);
      expect(error.details).toEqual(['Proof of address issued in the last 90 days']);
      expect(service.getOnboardingState('user-1')!.canSubmit).toBe(false);
    });

    it('returns 404 for unknown applicants', async () => {
      await expectKycError(() => service.submitForReview('ghost'), 'KYC_NOT_FOUND', 404);
    });

    it('auto-approves low-risk applications with verified documents', async () => {
      service.savePersonalInfo('user-1', person);
      await service.uploadDocument('user-1', passport());
      await service.uploadDocument('user-1', bankStatement());
      expect(service.getOnboardingState('user-1')!.canSubmit).toBe(true);

      const profile = service.submitForReview('user-1');

      expect(profile.status).toBe('approved');
      expect(profile.onboardingStep).toBe('complete');
      expect(profile.reviewedBy).toBe('system');
      expect(profile.expiresAt).toBe('2027-06-15T12:00:00.000Z');
      expect(service.isKycComplete('user-1')).toBe(true);
      expect(profile.statusHistory.map(h => h.to)).toEqual(['pending', 'under_review', 'approved']);
    });

    it('holds applications with unverified documents for manual review', async () => {
      service.savePersonalInfo('user-1', person);
      await service.uploadDocument('user-1', passport({ documentNumber: '123456999' }));
      await service.uploadDocument('user-1', bankStatement());

      const profile = service.submitForReview('user-1');

      expect(profile.status).toBe('under_review');
      expect(profile.onboardingStep).toBe('review');
      expect(service.listForReview().map(p => p.userId)).toEqual(['user-1']);
    });

    it('holds high-risk jurisdictions for manual review', async () => {
      service.savePersonalInfo('user-1', { ...person, countryOfResidence: 'IR' });
      await service.uploadDocument('user-1', passport());
      await service.uploadDocument('user-1', bankStatement());

      const profile = service.submitForReview('user-1');

      expect(profile.status).toBe('under_review');
      expect(service.assessRisk('user-1').factors).toContain('Nationality or residence in a high-risk jurisdiction');
    });

    it('cannot be submitted twice', async () => {
      service = new KycService({ autoApprove: false });
      service.savePersonalInfo('user-1', person);
      await service.uploadDocument('user-1', passport());
      await service.uploadDocument('user-1', bankStatement());
      service.submitForReview('user-1');

      await expectKycError(() => service.submitForReview('user-1'), 'INVALID_STATUS_TRANSITION', 409);
      await expectKycError(service.uploadDocument('user-1', bankStatement()), 'KYC_LOCKED', 409);
    });
  });

  describe('review', () => {
    beforeEach(async () => {
      service = new KycService({ autoApprove: false });
      service.savePersonalInfo('user-1', person);
      await service.uploadDocument('user-1', passport());
      await service.uploadDocument('user-1', bankStatement());
      service.submitForReview('user-1');
    });

    it('approves with reviewer details and a one-year expiry', () => {
      const profile = service.review('user-1', { decision: 'approved', reviewerId: 'admin-1', notes: 'Looks good' });

      expect(profile.status).toBe('approved');
      expect(profile.reviewedBy).toBe('admin-1');
      expect(profile.reviewNotes).toBe('Looks good');
      expect(profile.expiresAt).toBe('2027-06-15T12:00:00.000Z');
      expect(profile.statusHistory.at(-1)).toEqual(
        expect.objectContaining({ from: 'under_review', to: 'approved', actor: 'admin-1' }),
      );
    });

    it('rejects with reasons and lets the applicant resubmit', async () => {
      const rejected = service.review('user-1', {
        decision: 'rejected',
        reviewerId: 'admin-1',
        reasons: ['Name on bank statement does not match'],
      });
      expect(rejected.status).toBe('rejected');
      expect(rejected.rejectionReasons).toEqual(['Name on bank statement does not match']);
      expect(rejected.onboardingStep).toBe('documents');

      await service.uploadDocument('user-1', bankStatement({ fileName: 'statement-2.pdf' }));
      const state = service.getOnboardingState('user-1')!;
      expect(state.profile.status).toBe('pending');
      expect(state.canSubmit).toBe(true);
      expect(state.profile.statusHistory.at(-1)).toEqual(
        expect.objectContaining({ from: 'rejected', to: 'pending', reason: 'Documents resubmitted' }),
      );
    });

    it('requires a reason to reject', async () => {
      await expectKycError(
        () => service.review('user-1', { decision: 'rejected', reviewerId: 'admin-1', reasons: ['  '] }),
        'REJECTION_REASON_REQUIRED',
        400,
      );
      expect(service.getProfile('user-1')!.status).toBe('under_review');
    });

    it('does not allow deciding an application twice', async () => {
      service.review('user-1', { decision: 'approved', reviewerId: 'admin-1' });
      await expectKycError(
        () => service.review('user-1', { decision: 'rejected', reviewerId: 'admin-1', reasons: ['x'] }),
        'INVALID_STATUS_TRANSITION',
        409,
      );
    });
  });

  describe('reviewDocument', () => {
    it('lets a reviewer resolve a document flagged for manual review', async () => {
      service.savePersonalInfo('user-1', person);
      const doc = await service.uploadDocument('user-1', passport({ documentNumber: '123456999' }));

      const rejected = service.reviewDocument('user-1', doc.id, false, ['Photo is blurred']);
      expect(rejected.status).toBe('rejected');
      expect(rejected.rejectionReasons).toEqual(['Photo is blurred']);

      const approved = service.reviewDocument('user-1', doc.id, true);
      expect(approved.status).toBe('approved');
      expect(approved.rejectionReasons).toBeUndefined();
    });

    it('returns 404 for documents that belong to someone else', async () => {
      service.savePersonalInfo('user-1', person);
      service.savePersonalInfo('user-2', person);
      const doc = await service.uploadDocument('user-1', passport());

      await expectKycError(() => service.reviewDocument('user-2', doc.id, true), 'DOCUMENT_NOT_FOUND', 404);
    });
  });

  describe('expiry', () => {
    it('expires approvals after a year and allows re-verification', async () => {
      service.savePersonalInfo('user-1', person);
      await service.uploadDocument('user-1', passport());
      await service.uploadDocument('user-1', bankStatement());
      service.submitForReview('user-1');

      vi.setSystemTime(new Date('2027-06-16T00:00:00.000Z'));
      const state = service.getOnboardingState('user-1')!;
      expect(state.profile.status).toBe('expired');

      service.savePersonalInfo('user-1', person);
      expect(service.getProfile('user-1')!.status).toBe('pending');
    });
  });
});
