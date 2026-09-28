import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { KycService } from '../kyc.js';

describe('KycService', () => {
  let kycService: KycService;

  beforeEach(() => {
    kycService = new KycService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('submitDocument', () => {
    it('creates a new profile on first submission with status under_review', () => {
      const doc = kycService.submitDocument('user-1', 'passport', 'https://example.com/doc.pdf');

      expect(doc.id).toBeDefined();
      expect(doc.userId).toBe('user-1');
      expect(doc.type).toBe('passport');
      expect(doc.fileUrl).toBe('https://example.com/doc.pdf');
      expect(doc.verified).toBe(false);

      const profile = kycService.getProfile('user-1');
      expect(profile).toBeDefined();
      expect(profile!.status).toBe('under_review');
      expect(profile!.documents).toHaveLength(1);
      expect(profile!.documents[0].id).toBe(doc.id);
    });

    it('adds document to existing profile', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      const doc2 = kycService.submitDocument('user-1', 'utility_bill', 'https://example.com/bill.pdf');

      expect(doc2.type).toBe('utility_bill');

      const profile = kycService.getProfile('user-1');
      expect(profile!.documents).toHaveLength(2);
    });

    it('updates status from pending to under_review when adding doc', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      kycService.updateStatus('user-1', 'pending');

      const profileBefore = kycService.getProfile('user-1');
      expect(profileBefore!.status).toBe('pending');

      kycService.submitDocument('user-1', 'utility_bill', 'https://example.com/bill.pdf');

      const profileAfter = kycService.getProfile('user-1');
      expect(profileAfter!.status).toBe('under_review');
    });

    it('does not change status if already under_review', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      expect(kycService.getProfile('user-1')!.status).toBe('under_review');

      kycService.submitDocument('user-1', 'drivers_license', 'https://example.com/license.pdf');
      expect(kycService.getProfile('user-1')!.status).toBe('under_review');
    });
  });

  describe('verifyDocument', () => {
    it('marks document as verified', () => {
      const doc = kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      const result = kycService.verifyDocument(doc.id, true);

      expect(result).toBeDefined();
      expect(result!.verified).toBe(true);
      expect(result!.verifiedAt).toBeDefined();
    });

    it('marks document as rejected', () => {
      const doc = kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      const result = kycService.verifyDocument(doc.id, false);

      expect(result).toBeDefined();
      expect(result!.verified).toBe(false);
      expect(result!.verifiedAt).toBeDefined();
    });

    it('records document status and rejection reasons', () => {
      const doc = kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      expect(doc.status).toBe('pending');

      const rejected = kycService.verifyDocument(doc.id, false, ['Document is illegible']);
      expect(rejected!.status).toBe('rejected');
      expect(rejected!.rejectionReasons).toEqual(['Document is illegible']);

      const approved = kycService.verifyDocument(doc.id, true);
      expect(approved!.status).toBe('approved');
      expect(approved!.rejectionReasons).toBeUndefined();
    });

    it('returns undefined for unknown documentId', () => {
      const result = kycService.verifyDocument('nonexistent-doc-id', true);
      expect(result).toBeUndefined();
    });

    it('updates profile updatedAt when verifying', () => {
      vi.useFakeTimers();
      const doc = kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      const profileBefore = kycService.getProfile('user-1');
      const updatedAtBefore = profileBefore!.updatedAt;

      vi.advanceTimersByTime(1000);
      kycService.verifyDocument(doc.id, true);

      const profileAfter = kycService.getProfile('user-1');
      expect(profileAfter!.updatedAt).not.toBe(updatedAtBefore);
    });
  });

  describe('assessRisk', () => {
    it('returns score 0 for no profile', () => {
      const assessment = kycService.assessRisk('nonexistent-user');

      expect(assessment.score).toBe(0);
      expect(assessment.level).toBe('low');
      expect(assessment.factors).toContain('No KYC profile found');
    });

    it('returns higher score for no verified docs', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      const assessment = kycService.assessRisk('user-1');

      expect(assessment.score).toBeGreaterThan(0);
      expect(assessment.factors).toContain('No verified identity documents');
      expect(assessment.factors).toContain('AML check not yet completed');
    });

    it('returns lower score for verified docs', () => {
      const doc = kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      kycService.verifyDocument(doc.id, true);

      const unverifiedAssessment = kycService.assessRisk('user-1');
      kycService.runAmlCheck('user-1');
      kycService.runSanctionsCheck('user-1');
      kycService.runPepCheck('user-1');

      const verifiedAssessment = kycService.assessRisk('user-1');

      expect(verifiedAssessment.score).toBeLessThan(unverifiedAssessment.score);
    });

    it('factors are descriptive strings', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      const assessment = kycService.assessRisk('user-1');

      expect(assessment.factors.length).toBeGreaterThan(0);
      for (const factor of assessment.factors) {
        expect(typeof factor).toBe('string');
        expect(factor.length).toBeGreaterThan(0);
      }
    });

    it('returns assessedAt timestamp', () => {
      const assessment = kycService.assessRisk('nonexistent');
      expect(assessment.assessedAt).toBeDefined();
      expect(new Date(assessment.assessedAt).getTime()).not.toBeNaN();
    });
  });

  describe('runAmlCheck', () => {
    it('returns false for non-existent user', () => {
      const result = kycService.runAmlCheck('nonexistent-user');
      expect(result).toBe(false);
    });

    it('returns true and updates profile for existing user', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      const result = kycService.runAmlCheck('user-1');

      expect(result).toBe(true);
      expect(kycService.getProfile('user-1')!.amlCheckPassed).toBe(true);
    });
  });

  describe('runSanctionsCheck', () => {
    it('returns false for non-existent user', () => {
      const result = kycService.runSanctionsCheck('nonexistent-user');
      expect(result).toBe(false);
    });

    it('returns true and updates profile for existing user', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      const result = kycService.runSanctionsCheck('user-1');

      expect(result).toBe(true);
      expect(kycService.getProfile('user-1')!.sanctionsCheckPassed).toBe(true);
    });
  });

  describe('runPepCheck', () => {
    it('returns false for non-existent user', () => {
      const result = kycService.runPepCheck('nonexistent-user');
      expect(result).toBe(false);
    });

    it('returns true and updates profile for existing user', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      const result = kycService.runPepCheck('user-1');

      expect(result).toBe(true);
      expect(kycService.getProfile('user-1')!.pepCheckPassed).toBe(true);
    });
  });

  describe('getProfile', () => {
    it('returns profile by userId', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      const profile = kycService.getProfile('user-1');

      expect(profile).toBeDefined();
      expect(profile!.userId).toBe('user-1');
      expect(profile!.status).toBe('under_review');
      expect(profile!.documents).toHaveLength(1);
      expect(profile!.riskScore).toBe(0);
      expect(profile!.amlCheckPassed).toBe(false);
      expect(profile!.sanctionsCheckPassed).toBe(false);
      expect(profile!.pepCheckPassed).toBe(false);
    });

    it('returns undefined for unknown userId', () => {
      const profile = kycService.getProfile('nonexistent-user');
      expect(profile).toBeUndefined();
    });
  });

  describe('updateStatus', () => {
    it('sets status on profile', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      const result = kycService.updateStatus('user-1', 'approved');

      expect(result).toBeDefined();
      expect(result!.status).toBe('approved');
    });

    it('returns undefined for unknown userId', () => {
      const result = kycService.updateStatus('nonexistent-user', 'approved');
      expect(result).toBeUndefined();
    });

    it('sets expiresAt when status becomes approved', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      const result = kycService.updateStatus('user-1', 'approved');

      expect(result!.expiresAt).toBeDefined();
      const expiresAt = new Date(result!.expiresAt!);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('does not set expiresAt for non-approved status', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      kycService.updateStatus('user-1', 'approved');

      kycService.updateStatus('user-1', 'pending');
      const profile = kycService.getProfile('user-1');
      expect(profile!.expiresAt).toBeDefined();

      const profile2 = kycService.getProfile('user-1');
      profile2!.expiresAt = undefined;
      kycService.updateStatus('user-1', 'rejected');
      expect(kycService.getProfile('user-1')!.expiresAt).toBeUndefined();
    });

    it('records each change in the status history', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      kycService.updateStatus('user-1', 'rejected', 'Document is illegible');

      const history = kycService.getProfile('user-1')!.statusHistory;
      expect(history.map(h => [h.from, h.to])).toEqual([
        [null, 'under_review'],
        ['under_review', 'rejected'],
      ]);
      expect(history[1].reason).toBe('Document is illegible');
    });

    it('updates the updatedAt timestamp', () => {
      vi.useFakeTimers();
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      const before = kycService.getProfile('user-1')!.updatedAt;

      vi.advanceTimersByTime(1000);
      kycService.updateStatus('user-1', 'approved');
      const after = kycService.getProfile('user-1')!.updatedAt;

      expect(after).not.toBe(before);
    });
  });

  describe('isKycComplete', () => {
    it('returns false for non-existent user', () => {
      expect(kycService.isKycComplete('nonexistent-user')).toBe(false);
    });

    it('returns false when status is not approved', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      expect(kycService.isKycComplete('user-1')).toBe(false);
    });

    it('returns false when checks not passed', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      kycService.updateStatus('user-1', 'approved');

      expect(kycService.isKycComplete('user-1')).toBe(false);

      kycService.runAmlCheck('user-1');
      expect(kycService.isKycComplete('user-1')).toBe(false);

      kycService.runSanctionsCheck('user-1');
      expect(kycService.isKycComplete('user-1')).toBe(false);
    });

    it('returns true when all conditions met', () => {
      kycService.submitDocument('user-1', 'passport', 'https://example.com/passport.pdf');
      kycService.updateStatus('user-1', 'approved');
      kycService.runAmlCheck('user-1');
      kycService.runSanctionsCheck('user-1');
      kycService.runPepCheck('user-1');

      expect(kycService.isKycComplete('user-1')).toBe(true);
    });
  });

  describe('getRiskLevel', () => {
    it('returns low for score 0-25', () => {
      expect(kycService.getRiskLevel(0)).toBe('low');
      expect(kycService.getRiskLevel(10)).toBe('low');
      expect(kycService.getRiskLevel(25)).toBe('low');
    });

    it('returns medium for score 26-50', () => {
      expect(kycService.getRiskLevel(26)).toBe('medium');
      expect(kycService.getRiskLevel(40)).toBe('medium');
      expect(kycService.getRiskLevel(50)).toBe('medium');
    });

    it('returns high for score 51-75', () => {
      expect(kycService.getRiskLevel(51)).toBe('high');
      expect(kycService.getRiskLevel(60)).toBe('high');
      expect(kycService.getRiskLevel(75)).toBe('high');
    });

    it('returns critical for score 76-100', () => {
      expect(kycService.getRiskLevel(76)).toBe('critical');
      expect(kycService.getRiskLevel(90)).toBe('critical');
      expect(kycService.getRiskLevel(100)).toBe('critical');
    });
  });
});
