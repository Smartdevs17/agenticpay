import { createHash, randomUUID } from 'node:crypto';
import {
  ADDRESS_DOCUMENT_TYPES,
  IDENTITY_DOCUMENT_TYPES,
  MockDocumentVerificationProvider,
  maskDocumentNumber,
  validateKycDocument,
  validatePersonalInfo,
  type DocumentValidationResult,
  type DocumentVerificationProvider,
  type DocumentVerificationResult,
  type KycDocumentInput,
  type ProviderDecision,
} from './kyc-verification.js';

export type KycStatus = 'pending' | 'under_review' | 'approved' | 'rejected' | 'expired';

export type DocumentType =
  | 'passport'
  | 'drivers_license'
  | 'national_id'
  | 'utility_bill'
  | 'bank_statement';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type KycDocumentStatus = 'pending' | 'approved' | 'rejected';

export type KycOnboardingStep = 'personal_info' | 'documents' | 'review' | 'complete';

export interface KycAddress {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
}

export interface KycPersonalInfo {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  countryOfResidence: string;
  address: KycAddress;
}

export interface KycDocumentVerification {
  provider: string;
  reference: string;
  decision: ProviderDecision;
  confidence: number;
  checkedAt: string;
}

export interface KycDocument {
  id: string;
  userId: string;
  type: DocumentType;
  fileUrl?: string;
  uploadedAt: string;
  verified: boolean;
  verifiedAt?: string;
  status: KycDocumentStatus;
  rejectionReasons?: string[];
  warnings?: string[];
  documentNumberMasked?: string;
  issuingCountry?: string;
  issueDate?: string;
  expiryDate?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  sha256?: string;
  verification?: KycDocumentVerification;
}

export interface KycStatusChange {
  from: KycStatus | null;
  to: KycStatus;
  at: string;
  actor: string;
  reason?: string;
}

export interface KycProfile {
  userId: string;
  status: KycStatus;
  documents: KycDocument[];
  riskScore: number;
  riskLevel: RiskLevel;
  amlCheckPassed: boolean;
  sanctionsCheckPassed: boolean;
  pepCheckPassed: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  personalInfo?: KycPersonalInfo;
  onboardingStep: KycOnboardingStep;
  rejectionReasons: string[];
  reviewNotes?: string;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  statusHistory: KycStatusChange[];
}

export interface KycRequirement {
  id: 'identity_document' | 'proof_of_address';
  label: string;
  acceptedTypes: DocumentType[];
  satisfied: boolean;
}

export interface KycOnboardingState {
  profile: KycProfile;
  requirements: KycRequirement[];
  canSubmit: boolean;
}

export interface KycReviewDecision {
  decision: 'approved' | 'rejected';
  reviewerId: string;
  reasons?: string[];
  notes?: string;
}

export interface KycServiceOptions {
  verificationProvider?: DocumentVerificationProvider;
  /** Approve low-risk applications whose documents all passed automated checks. Default true. */
  autoApprove?: boolean;
}

export class KycError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400,
    readonly details?: string[],
  ) {
    super(message);
    this.name = 'KycError';
  }
}

export interface RiskAssessment {
  userId: string;
  score: number;
  level: RiskLevel;
  factors: string[];
  assessedAt: string;
}

const HIGH_RISK_COUNTRIES = [
  'AF', 'BI', 'KP', 'IR', 'IQ', 'LY', 'SO', 'SS', 'SY', 'YE',
  'CU', 'VE', 'MM', 'BY', 'RU', 'UA',
];

const now = (): string => new Date().toISOString();

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Applications move pending → under_review → approved | rejected. Rejected and
// expired applications return to pending when the applicant resubmits.
const ALLOWED_TRANSITIONS: Record<KycStatus, KycStatus[]> = {
  pending: ['under_review'],
  under_review: ['approved', 'rejected'],
  approved: ['expired'],
  rejected: ['pending'],
  expired: ['pending'],
};

const REQUIREMENTS: Array<Omit<KycRequirement, 'satisfied'>> = [
  { id: 'identity_document', label: 'Government-issued photo ID', acceptedTypes: IDENTITY_DOCUMENT_TYPES },
  { id: 'proof_of_address', label: 'Proof of address issued in the last 90 days', acceptedTypes: ADDRESS_DOCUMENT_TYPES },
];

export function canTransition(from: KycStatus, to: KycStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class KycService {
  private profiles = new Map<string, KycProfile>();
  // Fingerprints of identity document numbers → owning user, to stop one
  // document from being reused across accounts.
  private documentOwners = new Map<string, string>();
  private readonly verificationProvider: DocumentVerificationProvider;
  private readonly autoApprove: boolean;

  constructor(options: KycServiceOptions = {}) {
    this.verificationProvider = options.verificationProvider ?? new MockDocumentVerificationProvider();
    this.autoApprove = options.autoApprove ?? true;
  }

  submitDocument(userId: string, type: DocumentType, fileUrl: string): KycDocument {
    const profile = this.profiles.get(userId);

    const document: KycDocument = {
      id: randomUUID(),
      userId,
      type,
      fileUrl,
      uploadedAt: now(),
      verified: false,
      status: 'pending',
    };

    if (!profile) {
      const newProfile = this.createProfile(userId, 'under_review', userId, 'Document submitted');
      newProfile.documents.push(document);
      newProfile.onboardingStep = 'review';
    } else {
      profile.documents.push(document);
      if (profile.status === 'pending') {
        this.recordStatus(profile, 'under_review', userId, 'Document submitted');
      }
      profile.updatedAt = now();
    }

    return document;
  }

  verifyDocument(documentId: string, approved: boolean, reasons: string[] = []): KycDocument | undefined {
    for (const profile of this.profiles.values()) {
      const doc = profile.documents.find(d => d.id === documentId);
      if (doc) {
        doc.verified = approved;
        doc.verifiedAt = now();
        doc.status = approved ? 'approved' : 'rejected';
        doc.rejectionReasons = approved ? undefined : reasons;
        profile.updatedAt = now();
        return doc;
      }
    }
    return undefined;
  }

  assessRisk(userId: string): RiskAssessment {
    const profile = this.profiles.get(userId);
    const factors: string[] = [];
    let score = 0;

    if (!profile) {
      return {
        userId,
        score: 0,
        level: 'low',
        factors: ['No KYC profile found'],
        assessedAt: now(),
      };
    }

    const verifiedCount = profile.documents.filter(d => d.verified).length;
    if (verifiedCount === 0) {
      score += 15;
      factors.push('No verified identity documents');
    } else if (verifiedCount === 1) {
      score += 5;
      factors.push('Only one verified identity document');
    }

    if (profile.documents.length === 0) {
      score += 20;
      factors.push('No documents submitted');
    }

    const unverifiedDocs = profile.documents.filter(d => !d.verified);
    if (unverifiedDocs.length > 0) {
      score += unverifiedDocs.length * 3;
      factors.push(`${unverifiedDocs.length} document(s) pending verification`);
    }

    if (profile.amlCheckPassed) {
      score += 5;
      factors.push('AML check passed');
    } else {
      score += 15;
      factors.push('AML check not yet completed');
    }

    if (!profile.sanctionsCheckPassed) {
      score += 10;
      factors.push('Sanctions screening not yet completed');
    }

    if (!profile.pepCheckPassed) {
      score += 5;
      factors.push('PEP screening not yet completed');
    }

    if (profile.personalInfo && this.isHighRiskJurisdiction(profile.personalInfo)) {
      score += 30;
      factors.push('Nationality or residence in a high-risk jurisdiction');
    }

    const level = this.getRiskLevel(score);

    return {
      userId,
      score,
      level,
      factors,
      assessedAt: now(),
    };
  }

  runAmlCheck(userId: string): boolean {
    const profile = this.profiles.get(userId);
    if (!profile) return false;

    profile.amlCheckPassed = true;
    profile.updatedAt = now();
    return true;
  }

  runSanctionsCheck(userId: string): boolean {
    const profile = this.profiles.get(userId);
    if (!profile) return false;

    profile.sanctionsCheckPassed = true;
    profile.updatedAt = now();
    return true;
  }

  runPepCheck(userId: string): boolean {
    const profile = this.profiles.get(userId);
    if (!profile) return false;

    profile.pepCheckPassed = true;
    profile.updatedAt = now();
    return true;
  }

  getProfile(userId: string): KycProfile | undefined {
    return this.profiles.get(userId);
  }

  updateStatus(userId: string, status: KycStatus, reason?: string): KycProfile | undefined {
    const profile = this.profiles.get(userId);
    if (!profile) return undefined;

    this.recordStatus(profile, status, 'system', reason);

    if (status === 'approved') {
      profile.expiresAt = new Date(Date.now() + ONE_YEAR_MS).toISOString();
    }

    return profile;
  }

  isKycComplete(userId: string): boolean {
    const profile = this.profiles.get(userId);
    if (!profile) return false;

    return (
      profile.status === 'approved' &&
      profile.amlCheckPassed &&
      profile.sanctionsCheckPassed &&
      profile.pepCheckPassed
    );
  }

  getRiskLevel(score: number): RiskLevel {
    if (score <= 25) return 'low';
    if (score <= 50) return 'medium';
    if (score <= 75) return 'high';
    return 'critical';
  }

  // ── Onboarding flow (#921) ────────────────────────────────────────────────

  /** Step 1: create or update the applicant's personal details. */
  savePersonalInfo(userId: string, info: KycPersonalInfo): KycProfile {
    const errors = validatePersonalInfo(info);
    if (errors.length > 0) {
      throw new KycError('Personal information is invalid', 'INVALID_PERSONAL_INFO', 422, errors);
    }

    const profile = this.profiles.get(userId) ?? this.createProfile(userId, 'pending', userId, 'Onboarding started');
    this.assertEditable(profile);
    this.reopen(profile, userId, 'Personal information updated');

    profile.personalInfo = {
      ...info,
      nationality: info.nationality.toUpperCase(),
      countryOfResidence: info.countryOfResidence.toUpperCase(),
      address: { ...info.address, country: info.address.country.toUpperCase() },
    };
    profile.onboardingStep = this.nextStep(profile);
    profile.updatedAt = now();
    return profile;
  }

  /**
   * Step 2: validate a document locally, then hand it to the verification
   * provider. A newer upload replaces an earlier one of the same type.
   */
  async uploadDocument(userId: string, input: KycDocumentInput): Promise<KycDocument> {
    const profile = this.profiles.get(userId);
    if (!profile?.personalInfo) {
      throw new KycError('Complete personal information before uploading documents', 'PERSONAL_INFO_REQUIRED', 409);
    }
    this.assertEditable(profile);

    const validation = validateKycDocument(input);
    if (!validation.valid) {
      throw new KycError('Document failed validation', 'INVALID_DOCUMENT', 422, validation.errors);
    }

    const issuingCountry = input.issuingCountry.toUpperCase();
    const fingerprint = validation.normalizedDocumentNumber
      ? createHash('sha256').update(`${input.type}:${issuingCountry}:${validation.normalizedDocumentNumber}`).digest('hex')
      : undefined;
    const owner = fingerprint ? this.documentOwners.get(fingerprint) : undefined;
    if (owner && owner !== userId) {
      throw new KycError('Document failed validation', 'DUPLICATE_DOCUMENT', 409, [
        'This document is already linked to another account',
      ]);
    }

    this.reopen(profile, userId, 'Documents resubmitted');

    const document: KycDocument = {
      id: randomUUID(),
      userId,
      type: input.type,
      fileUrl: input.fileUrl,
      uploadedAt: now(),
      verified: false,
      status: 'pending',
      warnings: validation.warnings,
      documentNumberMasked: validation.normalizedDocumentNumber
        ? maskDocumentNumber(validation.normalizedDocumentNumber)
        : undefined,
      issuingCountry,
      issueDate: input.issueDate,
      expiryDate: input.expiryDate,
      fileName: input.fileName,
      mimeType: input.mimeType.toLowerCase(),
      fileSize: input.fileSize,
      sha256: validation.sha256,
    };

    const result = await this.runProviderCheck(profile, document, validation);
    this.applyProviderResult(document, result);

    profile.documents = profile.documents.filter(d => d.type !== document.type).concat(document);
    if (fingerprint) this.documentOwners.set(fingerprint, userId);
    profile.onboardingStep = this.nextStep(profile);
    profile.updatedAt = now();
    return document;
  }

  /** Current profile plus the outstanding requirements for the onboarding UI. */
  getOnboardingState(userId: string): KycOnboardingState | undefined {
    const profile = this.profiles.get(userId);
    if (!profile) return undefined;

    this.expireIfDue(profile);
    const requirements = this.getRequirements(profile);

    return {
      profile,
      requirements,
      canSubmit:
        profile.status === 'pending' &&
        profile.personalInfo !== undefined &&
        requirements.every(r => r.satisfied),
    };
  }

  getRequirements(profile: KycProfile): KycRequirement[] {
    return REQUIREMENTS.map(requirement => ({
      ...requirement,
      satisfied: profile.documents.some(
        d => requirement.acceptedTypes.includes(d.type) && d.status !== 'rejected',
      ),
    }));
  }

  /**
   * Step 3: submit for review. Runs screening checks and auto-approves
   * low-risk applications whose documents were all verified by the provider;
   * anything else waits for a reviewer.
   */
  submitForReview(userId: string): KycProfile {
    const profile = this.requireProfile(userId);

    if (profile.status !== 'pending') {
      throw new KycError(
        `KYC cannot be submitted while it is ${profile.status.replace(/_/g, ' ')}`,
        'INVALID_STATUS_TRANSITION',
        409,
      );
    }
    if (!profile.personalInfo) {
      throw new KycError('Complete personal information before submitting', 'PERSONAL_INFO_REQUIRED', 409);
    }

    const missing = this.getRequirements(profile).filter(r => !r.satisfied);
    if (missing.length > 0) {
      throw new KycError('Required documents are missing', 'REQUIREMENTS_NOT_MET', 422, missing.map(r => r.label));
    }

    this.transition(profile, 'under_review', userId, 'Submitted for review');
    profile.submittedAt = now();
    profile.rejectionReasons = [];

    this.runAmlCheck(userId);
    this.runSanctionsCheck(userId);
    this.runPepCheck(userId);

    const risk = this.assessRisk(userId);
    profile.riskScore = risk.score;
    profile.riskLevel = risk.level;

    if (this.autoApprove && this.qualifiesForAutoApproval(profile)) {
      this.approve(profile, 'system', 'All documents verified automatically');
    }

    profile.onboardingStep = this.nextStep(profile);
    return profile;
  }

  /** Manual reviewer decision for an application that is under review. */
  review(userId: string, decision: KycReviewDecision): KycProfile {
    const profile = this.requireProfile(userId);

    if (!canTransition(profile.status, decision.decision)) {
      throw new KycError(
        `Cannot ${decision.decision === 'approved' ? 'approve' : 'reject'} KYC while it is ${profile.status.replace(/_/g, ' ')}`,
        'INVALID_STATUS_TRANSITION',
        409,
      );
    }

    const reasons = (decision.reasons ?? []).map(r => r.trim()).filter(Boolean);

    if (decision.decision === 'approved') {
      this.approve(profile, decision.reviewerId, decision.notes);
    } else {
      if (reasons.length === 0) {
        throw new KycError('At least one reason is required to reject KYC', 'REJECTION_REASON_REQUIRED', 400);
      }
      this.transition(profile, 'rejected', decision.reviewerId, reasons.join('; '));
      profile.rejectionReasons = reasons;
      profile.reviewedAt = now();
      profile.reviewedBy = decision.reviewerId;
    }

    profile.reviewNotes = decision.notes;
    profile.onboardingStep = this.nextStep(profile);
    return profile;
  }

  /** Manual decision on a single document, e.g. one the provider flagged for review. */
  reviewDocument(userId: string, documentId: string, approved: boolean, reasons: string[] = []): KycDocument {
    const profile = this.requireProfile(userId);
    const document = profile.documents.find(d => d.id === documentId);
    if (!document) throw new KycError('Document not found', 'DOCUMENT_NOT_FOUND', 404);

    if (profile.status !== 'pending' && profile.status !== 'under_review') {
      throw new KycError(
        `Documents cannot be reviewed while KYC is ${profile.status.replace(/_/g, ' ')}`,
        'KYC_LOCKED',
        409,
      );
    }

    this.verifyDocument(documentId, approved, reasons);
    profile.onboardingStep = this.nextStep(profile);
    return document;
  }

  listForReview(): KycProfile[] {
    return Array.from(this.profiles.values()).filter(p => p.status === 'under_review');
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private createProfile(userId: string, status: KycStatus, actor = 'system', reason?: string): KycProfile {
    const profile: KycProfile = {
      userId,
      status,
      documents: [],
      riskScore: 0,
      riskLevel: 'low',
      amlCheckPassed: false,
      sanctionsCheckPassed: false,
      pepCheckPassed: false,
      createdAt: now(),
      updatedAt: now(),
      onboardingStep: 'personal_info',
      rejectionReasons: [],
      statusHistory: [{ from: null, to: status, at: now(), actor, reason }],
    };
    this.profiles.set(userId, profile);
    return profile;
  }

  private requireProfile(userId: string): KycProfile {
    const profile = this.profiles.get(userId);
    if (!profile) throw new KycError('KYC profile not found', 'KYC_NOT_FOUND', 404);
    return profile;
  }

  private recordStatus(profile: KycProfile, to: KycStatus, actor: string, reason?: string): void {
    profile.statusHistory.push({ from: profile.status, to, at: now(), actor, reason });
    profile.status = to;
    profile.updatedAt = now();
  }

  private transition(profile: KycProfile, to: KycStatus, actor: string, reason?: string): void {
    if (!canTransition(profile.status, to)) {
      throw new KycError(`Cannot move KYC from ${profile.status} to ${to}`, 'INVALID_STATUS_TRANSITION', 409);
    }
    this.recordStatus(profile, to, actor, reason);
  }

  private assertEditable(profile: KycProfile): void {
    if (profile.status === 'under_review' || profile.status === 'approved') {
      throw new KycError(
        `KYC cannot be changed while it is ${profile.status.replace(/_/g, ' ')}`,
        'KYC_LOCKED',
        409,
      );
    }
  }

  /** Rejected and expired applications return to pending when the applicant edits them. */
  private reopen(profile: KycProfile, actor: string, reason: string): void {
    if (profile.status === 'rejected' || profile.status === 'expired') {
      this.transition(profile, 'pending', actor, reason);
    }
  }

  private approve(profile: KycProfile, actor: string, reason?: string): void {
    this.transition(profile, 'approved', actor, reason);
    profile.expiresAt = new Date(Date.now() + ONE_YEAR_MS).toISOString();
    profile.rejectionReasons = [];
    profile.reviewedAt = now();
    profile.reviewedBy = actor;
  }

  private expireIfDue(profile: KycProfile): void {
    if (profile.status === 'approved' && profile.expiresAt && Date.parse(profile.expiresAt) <= Date.now()) {
      this.transition(profile, 'expired', 'system', 'Verification period ended');
      profile.onboardingStep = this.nextStep(profile);
    }
  }

  private nextStep(profile: KycProfile): KycOnboardingStep {
    if (profile.status === 'approved') return 'complete';
    if (profile.status === 'under_review') return 'review';
    if (!profile.personalInfo) return 'personal_info';
    if (profile.status === 'pending' && this.getRequirements(profile).every(r => r.satisfied)) return 'review';
    return 'documents';
  }

  private isHighRiskJurisdiction(info: KycPersonalInfo): boolean {
    return (
      HIGH_RISK_COUNTRIES.includes(info.nationality.toUpperCase()) ||
      HIGH_RISK_COUNTRIES.includes(info.countryOfResidence.toUpperCase())
    );
  }

  private qualifiesForAutoApproval(profile: KycProfile): boolean {
    return (
      profile.documents.length > 0 &&
      profile.documents.every(d => d.status === 'approved') &&
      profile.riskLevel === 'low' &&
      profile.personalInfo !== undefined &&
      !this.isHighRiskJurisdiction(profile.personalInfo)
    );
  }

  private async runProviderCheck(
    profile: KycProfile,
    document: KycDocument,
    validation: DocumentValidationResult,
  ): Promise<DocumentVerificationResult> {
    try {
      return await this.verificationProvider.verify({
        userId: profile.userId,
        documentId: document.id,
        type: document.type,
        issuingCountry: document.issuingCountry ?? '',
        documentNumber: validation.normalizedDocumentNumber,
        issueDate: document.issueDate,
        expiryDate: document.expiryDate,
        mimeType: document.mimeType ?? '',
        sha256: validation.sha256,
        file: validation.file,
        fileUrl: document.fileUrl,
        personalInfo: profile.personalInfo,
      });
    } catch {
      return {
        decision: 'needs_review',
        reasons: ['Verification provider unavailable; document queued for manual review'],
        confidence: 0,
        reference: '',
      };
    }
  }

  private applyProviderResult(document: KycDocument, result: DocumentVerificationResult): void {
    const checkedAt = now();
    document.verification = {
      provider: this.verificationProvider.name,
      reference: result.reference,
      decision: result.decision,
      confidence: result.confidence,
      checkedAt,
    };

    if (result.decision === 'approved') {
      document.status = 'approved';
      document.verified = true;
      document.verifiedAt = checkedAt;
    } else if (result.decision === 'rejected') {
      document.status = 'rejected';
      document.rejectionReasons = result.reasons;
    } else {
      document.warnings = [...(document.warnings ?? []), ...result.reasons];
    }
  }
}

export const kycService = new KycService();
