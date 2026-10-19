import { resolveApiUrl } from '@/lib/api/client';

// Types and client-side checks for the KYC onboarding flow (#921). The checks
// mirror backend/src/services/kyc-verification.ts so applicants get feedback
// before uploading; the backend remains the source of truth.

export type KycStatus = 'pending' | 'under_review' | 'approved' | 'rejected' | 'expired';
export type KycDocumentStatus = 'pending' | 'approved' | 'rejected';
export type KycOnboardingStep = 'personal_info' | 'documents' | 'review' | 'complete';
export type KycDocumentType =
  | 'passport'
  | 'drivers_license'
  | 'national_id'
  | 'utility_bill'
  | 'bank_statement';

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

export interface KycDocument {
  id: string;
  type: KycDocumentType;
  status: KycDocumentStatus;
  uploadedAt: string;
  fileName?: string;
  documentNumberMasked?: string;
  issuingCountry?: string;
  issueDate?: string;
  expiryDate?: string;
  rejectionReasons?: string[];
  warnings?: string[];
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
  onboardingStep: KycOnboardingStep;
  personalInfo?: KycPersonalInfo;
  documents: KycDocument[];
  rejectionReasons: string[];
  reviewNotes?: string;
  submittedAt?: string;
  reviewedAt?: string;
  expiresAt?: string;
  statusHistory: KycStatusChange[];
}

export interface KycRequirement {
  id: 'identity_document' | 'proof_of_address';
  label: string;
  acceptedTypes: KycDocumentType[];
  satisfied: boolean;
}

export interface KycOnboardingState {
  profile: KycProfile;
  requirements: KycRequirement[];
  canSubmit: boolean;
}

export interface KycDocumentForm {
  type: KycDocumentType;
  documentNumber: string;
  issuingCountry: string;
  issueDate: string;
  expiryDate: string;
}

export interface KycDocumentUpload {
  type: KycDocumentType;
  documentNumber?: string;
  issuingCountry: string;
  issueDate?: string;
  expiryDate?: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileContent: string;
}

export type FieldErrors = Record<string, string>;

// ── Rules ────────────────────────────────────────────────────────────────────

export const IDENTITY_DOCUMENT_TYPES: KycDocumentType[] = ['passport', 'drivers_license', 'national_id'];
export const ADDRESS_DOCUMENT_TYPES: KycDocumentType[] = ['utility_bill', 'bank_statement'];

export const DOCUMENT_TYPE_LABELS: Record<KycDocumentType, string> = {
  passport: 'Passport',
  drivers_license: "Driver's license",
  national_id: 'National ID card',
  utility_bill: 'Utility bill',
  bank_statement: 'Bank statement',
};

export const KYC_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const KYC_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const KYC_MIN_FILE_BYTES = 1024;
export const PROOF_OF_ADDRESS_MAX_AGE_DAYS = 90;
export const MINIMUM_AGE = 18;

const DAY_MS = 24 * 60 * 60 * 1000;
const COUNTRY_CODE = /^[A-Za-z]{2}$/;
const DOCUMENT_NUMBER = /^[A-Z0-9]{4,20}$/;

export function isIdentityDocument(type: KycDocumentType): boolean {
  return IDENTITY_DOCUMENT_TYPES.includes(type);
}

export function parseIsoDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10) === value ? date : undefined;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function ageOn(dateOfBirth: Date, now: Date): number {
  const age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() && now.getUTCDate() < dateOfBirth.getUTCDate());
  return beforeBirthday ? age - 1 : age;
}

// ── Validation ───────────────────────────────────────────────────────────────

export function validatePersonalInfo(info: KycPersonalInfo, now: Date = new Date()): FieldErrors {
  const errors: FieldErrors = {};

  if (!info.firstName.trim()) errors.firstName = 'First name is required';
  if (!info.lastName.trim()) errors.lastName = 'Last name is required';

  const dateOfBirth = parseIsoDate(info.dateOfBirth);
  if (!dateOfBirth) {
    errors.dateOfBirth = 'Enter a valid date of birth';
  } else if (dateOfBirth > now) {
    errors.dateOfBirth = 'Date of birth cannot be in the future';
  } else if (ageOn(dateOfBirth, now) < MINIMUM_AGE) {
    errors.dateOfBirth = `You must be at least ${MINIMUM_AGE} years old`;
  }

  if (!COUNTRY_CODE.test(info.nationality)) errors.nationality = 'Use a 2-letter country code, e.g. US';
  if (!COUNTRY_CODE.test(info.countryOfResidence)) {
    errors.countryOfResidence = 'Use a 2-letter country code, e.g. US';
  }
  if (!info.address.line1.trim()) errors['address.line1'] = 'Address is required';
  if (!info.address.city.trim()) errors['address.city'] = 'City is required';
  if (info.address.postalCode.trim().length < 2) errors['address.postalCode'] = 'Postal code is required';
  if (!COUNTRY_CODE.test(info.address.country)) errors['address.country'] = 'Use a 2-letter country code, e.g. US';

  return errors;
}

export function validateDocumentFile(file: File | null): string | undefined {
  if (!file) return 'Choose a file to upload';
  if (!KYC_ALLOWED_MIME_TYPES.includes(file.type)) return 'Upload a JPEG, PNG, WebP, or PDF file';
  if (file.size > KYC_MAX_FILE_BYTES) return 'File must be 10 MB or smaller';
  if (file.size < KYC_MIN_FILE_BYTES) return 'File is too small to be a legible document';
  return undefined;
}

export function validateDocumentForm(form: KycDocumentForm, file: File | null, now: Date = new Date()): FieldErrors {
  const errors: FieldErrors = {};
  const today = startOfUtcDay(now);

  if (!COUNTRY_CODE.test(form.issuingCountry)) errors.issuingCountry = 'Use a 2-letter country code, e.g. US';

  if (isIdentityDocument(form.type)) {
    const number = form.documentNumber.replace(/[\s-]/g, '').toUpperCase();
    if (!number) errors.documentNumber = 'Document number is required';
    else if (!DOCUMENT_NUMBER.test(number)) errors.documentNumber = 'Use letters and digits only';

    const expiry = parseIsoDate(form.expiryDate);
    if (!expiry) errors.expiryDate = 'Enter the expiry date';
    else if (expiry <= today) errors.expiryDate = 'This document has expired';
  } else {
    const issued = parseIsoDate(form.issueDate);
    if (!issued) errors.issueDate = 'Enter the issue date';
    else if (issued > today) errors.issueDate = 'Issue date cannot be in the future';
    else if (today.getTime() - issued.getTime() > PROOF_OF_ADDRESS_MAX_AGE_DAYS * DAY_MS) {
      errors.issueDate = `Must be issued within the last ${PROOF_OF_ADDRESS_MAX_AGE_DAYS} days`;
    }
  }

  const fileError = validateDocumentFile(file);
  if (fileError) errors.file = fileError;

  return errors;
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

// ── API ──────────────────────────────────────────────────────────────────────

export class KycApiError extends Error {
  status: number;
  code?: string;
  details: string[];

  constructor(message: string, status: number, code?: string, details: string[] = []) {
    super(message);
    this.name = 'KycApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorEnvelope {
  error?: string | { code?: string; message?: string; details?: unknown };
  message?: string;
  details?: Array<{ path: string; message: string }>;
}

function toKycApiError(status: number, body: ErrorEnvelope | null): KycApiError {
  if (body && typeof body.error === 'object') {
    const details = Array.isArray(body.error.details) ? body.error.details.map(String) : [];
    return new KycApiError(body.error.message ?? 'Request failed', status, body.error.code, details);
  }
  const details = (body?.details ?? []).map((d) => `${d.path}: ${d.message}`);
  return new KycApiError(body?.message ?? 'Request failed', status, typeof body?.error === 'string' ? body.error : undefined, details);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(resolveApiUrl(path), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw toKycApiError(response.status, body as ErrorEnvelope | null);
  return body as T;
}

const userPath = (userId: string) => `/kyc/${encodeURIComponent(userId)}`;

export const kycApi = {
  /** Resolves to `null` when the applicant has not started onboarding. */
  getState: async (userId: string): Promise<KycOnboardingState | null> => {
    try {
      return await request<KycOnboardingState>(userPath(userId));
    } catch (error) {
      if (error instanceof KycApiError && error.status === 404) return null;
      throw error;
    }
  },
  savePersonalInfo: (userId: string, info: KycPersonalInfo) =>
    request<KycOnboardingState>(`${userPath(userId)}/personal-info`, {
      method: 'PUT',
      body: JSON.stringify(info),
    }),
  uploadDocument: (userId: string, upload: KycDocumentUpload) =>
    request<{ document: KycDocument; state: KycOnboardingState }>(`${userPath(userId)}/documents`, {
      method: 'POST',
      body: JSON.stringify(upload),
    }),
  submit: (userId: string) =>
    request<KycOnboardingState>(`${userPath(userId)}/submit`, { method: 'POST' }),
};
