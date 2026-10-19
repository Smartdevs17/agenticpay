// Issue #921: KYC document verification.
//
// Two layers:
// - Local format checks (file type/size/signature, document-number patterns,
//   issue and expiry dates) that run before anything leaves the process.
// - A pluggable `DocumentVerificationProvider` for authenticity checks. The
//   default `MockDocumentVerificationProvider` is deterministic so the flow can
//   be exercised end-to-end without a third-party vendor.

import { createHash, randomUUID } from 'node:crypto';
import {
  CATEGORY_ALLOWED_TYPES,
  CATEGORY_MAX_BYTES,
  validateMagicBytes,
} from '../middleware/file-upload.js';
import type { DocumentType, KycPersonalInfo } from './kyc.js';

// ── Rules ────────────────────────────────────────────────────────────────────

export const DOCUMENT_TYPES: DocumentType[] = [
  'passport',
  'drivers_license',
  'national_id',
  'utility_bill',
  'bank_statement',
];

export const IDENTITY_DOCUMENT_TYPES: DocumentType[] = ['passport', 'drivers_license', 'national_id'];
export const ADDRESS_DOCUMENT_TYPES: DocumentType[] = ['utility_bill', 'bank_statement'];

export const KYC_ALLOWED_MIME_TYPES = CATEGORY_ALLOWED_TYPES.kyc;
export const KYC_MAX_FILE_BYTES = CATEGORY_MAX_BYTES.kyc;
// Anything smaller cannot be a legible scan or photo of a document.
export const KYC_MIN_FILE_BYTES = 1024;

export const PROOF_OF_ADDRESS_MAX_AGE_DAYS = 90;
export const EXPIRY_WARNING_DAYS = 30;
export const MAX_EXPIRY_YEARS = 20;
export const MINIMUM_AGE = 18;
export const MAXIMUM_AGE = 120;

const MIME_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};

const DOCUMENT_NUMBER_PATTERNS: Partial<Record<DocumentType, RegExp>> = {
  passport: /^[A-Z0-9]{6,9}$/,
  national_id: /^[A-Z0-9]{5,20}$/,
  drivers_license: /^[A-Z0-9]{4,20}$/,
};

// Issuers with a published, fixed number layout override the generic pattern.
const COUNTRY_DOCUMENT_NUMBER_PATTERNS: Record<string, Partial<Record<DocumentType, RegExp>>> = {
  US: { passport: /^[A-Z0-9]\d{8}$/ },
  GB: { passport: /^\d{9}$/ },
  IN: { passport: /^[A-Z]\d{7}$/ },
  NG: { passport: /^[A-Z]\d{8}$/, national_id: /^\d{11}$/ },
};

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isIdentityDocument(type: DocumentType): boolean {
  return IDENTITY_DOCUMENT_TYPES.includes(type);
}

export function isAddressDocument(type: DocumentType): boolean {
  return ADDRESS_DOCUMENT_TYPES.includes(type);
}

export function normalizeDocumentNumber(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function maskDocumentNumber(value: string): string {
  const normalized = normalizeDocumentNumber(value);
  const visible = normalized.slice(-4);
  return `${'*'.repeat(Math.max(normalized.length - visible.length, 0))}${visible}`;
}

export function getDocumentNumberPattern(type: DocumentType, issuingCountry: string): RegExp | undefined {
  return COUNTRY_DOCUMENT_NUMBER_PATTERNS[issuingCountry.toUpperCase()]?.[type] ?? DOCUMENT_NUMBER_PATTERNS[type];
}

/** Parses a strict `YYYY-MM-DD` calendar date as UTC midnight. */
export function parseIsoDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  // Reject dates JavaScript silently rolls over, e.g. 2024-02-30.
  return date.toISOString().slice(0, 10) === value ? date : undefined;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function calculateAge(dateOfBirth: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() && now.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function stripDataUrlPrefix(content: string): string {
  const match = /^data:[^;,]+;base64,/i.exec(content);
  return match ? content.slice(match[0].length) : content;
}

function decodeBase64(content: string): Buffer | undefined {
  const cleaned = stripDataUrlPrefix(content).replace(/\s/g, '');
  if (cleaned.length === 0 || cleaned.length % 4 !== 0) return undefined;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return undefined;
  return Buffer.from(cleaned, 'base64');
}

// ── Personal info ────────────────────────────────────────────────────────────

export function validatePersonalInfo(info: KycPersonalInfo, now: Date = new Date()): string[] {
  const errors: string[] = [];
  const dateOfBirth = parseIsoDate(info.dateOfBirth);

  if (!dateOfBirth) {
    errors.push('Date of birth must be a valid date in YYYY-MM-DD format');
  } else if (dateOfBirth > now) {
    errors.push('Date of birth cannot be in the future');
  } else {
    const age = calculateAge(dateOfBirth, now);
    if (age < MINIMUM_AGE) errors.push(`Applicant must be at least ${MINIMUM_AGE} years old`);
    if (age > MAXIMUM_AGE) errors.push('Date of birth is not plausible');
  }

  return errors;
}

// ── Documents ────────────────────────────────────────────────────────────────

export interface KycDocumentInput {
  type: DocumentType;
  documentNumber?: string;
  issuingCountry: string;
  issueDate?: string;
  expiryDate?: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  /** Base64 file contents, optionally as a `data:` URL. */
  fileContent?: string;
  /** HTTPS location of a file already held in storage. */
  fileUrl?: string;
}

export interface DocumentValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalizedDocumentNumber?: string;
  file?: Buffer;
  sha256?: string;
}

function validateFile(input: KycDocumentInput, errors: string[]): { file?: Buffer; sha256?: string } {
  const mimeType = input.mimeType.toLowerCase();

  if (!KYC_ALLOWED_MIME_TYPES.includes(mimeType)) {
    errors.push(`Unsupported file type "${input.mimeType}". Allowed: ${KYC_ALLOWED_MIME_TYPES.join(', ')}`);
  } else {
    const extension = input.fileName.split('.').pop()?.toLowerCase() ?? '';
    if (!MIME_EXTENSIONS[mimeType]?.includes(extension)) {
      errors.push(`File extension ".${extension}" does not match file type ${mimeType}`);
    }
  }

  if (input.fileSize > KYC_MAX_FILE_BYTES) {
    errors.push(`File exceeds the ${KYC_MAX_FILE_BYTES / (1024 * 1024)} MB limit`);
  } else if (input.fileSize < KYC_MIN_FILE_BYTES) {
    errors.push('File is too small to be a legible document image');
  }

  if (!input.fileContent && !input.fileUrl) {
    errors.push('Either fileContent or fileUrl is required');
    return {};
  }

  if (input.fileUrl && !input.fileContent) {
    let protocol = '';
    try {
      protocol = new URL(input.fileUrl).protocol;
    } catch {
      // handled below
    }
    if (protocol !== 'https:') errors.push('fileUrl must be an https URL');
    return {};
  }

  const file = decodeBase64(input.fileContent ?? '');
  if (!file) {
    errors.push('fileContent must be valid base64');
    return {};
  }
  if (file.length !== input.fileSize) {
    errors.push(`Declared file size (${input.fileSize} bytes) does not match uploaded content (${file.length} bytes)`);
  }
  if (KYC_ALLOWED_MIME_TYPES.includes(mimeType) && !validateMagicBytes(file, mimeType)) {
    errors.push(`File contents are not a valid ${mimeType} file`);
  }

  return { file, sha256: createHash('sha256').update(file).digest('hex') };
}

function validateIdentityFields(
  input: KycDocumentInput,
  now: Date,
  errors: string[],
  warnings: string[],
): string | undefined {
  let normalizedNumber: string | undefined;

  if (!input.documentNumber) {
    errors.push('Document number is required for identity documents');
  } else {
    normalizedNumber = normalizeDocumentNumber(input.documentNumber);
    const pattern = getDocumentNumberPattern(input.type, input.issuingCountry);
    if (pattern && !pattern.test(normalizedNumber)) {
      errors.push(`Document number format is not valid for a ${input.issuingCountry.toUpperCase()} ${input.type.replace(/_/g, ' ')}`);
    }
  }

  const today = startOfUtcDay(now);
  const issueDate = input.issueDate ? parseIsoDate(input.issueDate) : undefined;
  if (input.issueDate && !issueDate) errors.push('Issue date must be a valid date in YYYY-MM-DD format');
  if (issueDate && issueDate > today) errors.push('Issue date cannot be in the future');

  if (!input.expiryDate) {
    errors.push('Expiry date is required for identity documents');
    return normalizedNumber;
  }

  const expiryDate = parseIsoDate(input.expiryDate);
  if (!expiryDate) {
    errors.push('Expiry date must be a valid date in YYYY-MM-DD format');
    return normalizedNumber;
  }

  if (expiryDate <= today) {
    errors.push(`Document expired on ${input.expiryDate}`);
  } else if (expiryDate.getTime() - today.getTime() <= EXPIRY_WARNING_DAYS * DAY_MS) {
    warnings.push(`Document expires within ${EXPIRY_WARNING_DAYS} days`);
  }

  const latestExpiry = new Date(today);
  latestExpiry.setUTCFullYear(latestExpiry.getUTCFullYear() + MAX_EXPIRY_YEARS);
  if (expiryDate > latestExpiry) errors.push('Expiry date is too far in the future');

  if (issueDate && issueDate >= expiryDate) errors.push('Issue date must be before the expiry date');

  return normalizedNumber;
}

function validateAddressFields(input: KycDocumentInput, now: Date, errors: string[]): void {
  if (!input.issueDate) {
    errors.push('Issue date is required for proof-of-address documents');
    return;
  }

  const issueDate = parseIsoDate(input.issueDate);
  if (!issueDate) {
    errors.push('Issue date must be a valid date in YYYY-MM-DD format');
    return;
  }

  const today = startOfUtcDay(now);
  if (issueDate > today) {
    errors.push('Issue date cannot be in the future');
  } else if (today.getTime() - issueDate.getTime() > PROOF_OF_ADDRESS_MAX_AGE_DAYS * DAY_MS) {
    errors.push(`Proof of address must be issued within the last ${PROOF_OF_ADDRESS_MAX_AGE_DAYS} days`);
  }
}

/** Runs every local format check for a KYC document submission. */
export function validateKycDocument(input: KycDocumentInput, now: Date = new Date()): DocumentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let normalizedDocumentNumber: string | undefined;

  if (!DOCUMENT_TYPES.includes(input.type)) {
    errors.push(`Unsupported document type "${input.type}"`);
  }

  if (!/^[A-Z]{2}$/i.test(input.issuingCountry)) {
    errors.push('Issuing country must be a 2-letter ISO country code');
  }

  const { file, sha256 } = validateFile(input, errors);

  if (isIdentityDocument(input.type)) {
    normalizedDocumentNumber = validateIdentityFields(input, now, errors, warnings);
  } else if (isAddressDocument(input.type)) {
    validateAddressFields(input, now, errors);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedDocumentNumber,
    file,
    sha256,
  };
}

// ── Verification providers ───────────────────────────────────────────────────

export type ProviderDecision = 'approved' | 'rejected' | 'needs_review';

export interface DocumentVerificationRequest {
  userId: string;
  documentId: string;
  type: DocumentType;
  issuingCountry: string;
  documentNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  mimeType: string;
  sha256?: string;
  file?: Buffer;
  fileUrl?: string;
  personalInfo?: KycPersonalInfo;
}

export interface DocumentVerificationResult {
  decision: ProviderDecision;
  reasons: string[];
  /** Provider confidence in the decision, 0..1. */
  confidence: number;
  /** Provider-side identifier for the check, kept for audit. */
  reference: string;
}

/**
 * Contract for third-party document verification vendors. Implementations
 * should return `needs_review` rather than throw when a check is inconclusive.
 */
export interface DocumentVerificationProvider {
  readonly name: string;
  verify(request: DocumentVerificationRequest): Promise<DocumentVerificationResult>;
}

/**
 * Deterministic sandbox provider. Document numbers ending in `000` are
 * rejected as lost/stolen and numbers ending in `999` are routed to manual
 * review; everything else that passed local validation is approved.
 */
export class MockDocumentVerificationProvider implements DocumentVerificationProvider {
  readonly name = 'mock';

  async verify(request: DocumentVerificationRequest): Promise<DocumentVerificationResult> {
    const reference = `mock_${randomUUID()}`;
    const documentNumber = request.documentNumber ?? '';

    if (documentNumber.endsWith('000')) {
      return {
        decision: 'rejected',
        reasons: ['Document number is reported as lost or stolen'],
        confidence: 0.99,
        reference,
      };
    }

    if (documentNumber.endsWith('999')) {
      return {
        decision: 'needs_review',
        reasons: ['Automated checks were inconclusive; manual review required'],
        confidence: 0.5,
        reference,
      };
    }

    return { decision: 'approved', reasons: [], confidence: 0.95, reference };
  }
}
