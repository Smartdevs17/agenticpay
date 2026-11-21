import { describe, expect, it } from 'vitest';
import {
  KYC_MAX_FILE_BYTES,
  MockDocumentVerificationProvider,
  calculateAge,
  getDocumentNumberPattern,
  maskDocumentNumber,
  normalizeDocumentNumber,
  parseIsoDate,
  validateKycDocument,
  validatePersonalInfo,
  type KycDocumentInput,
} from '../kyc-verification.js';
import type { KycPersonalInfo } from '../kyc.js';

const NOW = new Date('2026-06-15T12:00:00.000Z');

const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2048, 0x20)]);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(2048, 0x00),
]);

function passport(overrides: Partial<KycDocumentInput> = {}): KycDocumentInput {
  return {
    type: 'passport',
    documentNumber: 'X1234567',
    issuingCountry: 'DE',
    issueDate: '2022-01-10',
    expiryDate: '2032-01-09',
    fileName: 'passport.pdf',
    mimeType: 'application/pdf',
    fileSize: pdf.length,
    fileContent: pdf.toString('base64'),
    ...overrides,
  };
}

function utilityBill(overrides: Partial<KycDocumentInput> = {}): KycDocumentInput {
  return {
    type: 'utility_bill',
    issuingCountry: 'DE',
    issueDate: '2026-05-20',
    fileName: 'bill.png',
    mimeType: 'image/png',
    fileSize: png.length,
    fileContent: png.toString('base64'),
    ...overrides,
  };
}

const person: KycPersonalInfo = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: '1990-04-12',
  nationality: 'GB',
  countryOfResidence: 'GB',
  address: { line1: '1 Main St', city: 'London', postalCode: 'N1 9GU', country: 'GB' },
};

describe('kyc-verification helpers', () => {
  it('parses strict ISO dates and rejects rollovers', () => {
    expect(parseIsoDate('2024-02-29')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(parseIsoDate('2023-02-29')).toBeUndefined();
    expect(parseIsoDate('2024-13-01')).toBeUndefined();
    expect(parseIsoDate('12/01/2024')).toBeUndefined();
  });

  it('calculates age around the birthday boundary', () => {
    expect(calculateAge(new Date('2008-06-15T00:00:00Z'), NOW)).toBe(18);
    expect(calculateAge(new Date('2008-06-16T00:00:00Z'), NOW)).toBe(17);
  });

  it('normalizes and masks document numbers', () => {
    expect(normalizeDocumentNumber(' ab-12 345 ')).toBe('AB12345');
    expect(maskDocumentNumber('X1234567')).toBe('****4567');
    expect(maskDocumentNumber('123')).toBe('123');
  });

  it('prefers country-specific document number patterns', () => {
    expect(getDocumentNumberPattern('passport', 'gb')?.test('123456789')).toBe(true);
    expect(getDocumentNumberPattern('passport', 'GB')?.test('X1234567')).toBe(false);
    expect(getDocumentNumberPattern('passport', 'DE')?.test('X1234567')).toBe(true);
    expect(getDocumentNumberPattern('utility_bill', 'DE')).toBeUndefined();
  });
});

describe('validatePersonalInfo', () => {
  it('accepts an adult applicant', () => {
    expect(validatePersonalInfo(person, NOW)).toEqual([]);
  });

  it('rejects applicants under 18', () => {
    expect(validatePersonalInfo({ ...person, dateOfBirth: '2010-01-01' }, NOW)).toEqual([
      'Applicant must be at least 18 years old',
    ]);
  });

  it('rejects future, implausible, and malformed dates of birth', () => {
    expect(validatePersonalInfo({ ...person, dateOfBirth: '2030-01-01' }, NOW)).toEqual([
      'Date of birth cannot be in the future',
    ]);
    expect(validatePersonalInfo({ ...person, dateOfBirth: '1850-01-01' }, NOW)).toEqual([
      'Date of birth is not plausible',
    ]);
    expect(validatePersonalInfo({ ...person, dateOfBirth: '1990-02-30' }, NOW)).toHaveLength(1);
  });
});

describe('validateKycDocument', () => {
  it('accepts a valid passport and returns the normalized number and hash', () => {
    const result = validateKycDocument(passport({ documentNumber: 'x123-4567' }), NOW);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.normalizedDocumentNumber).toBe('X1234567');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.file?.length).toBe(pdf.length);
  });

  it('accepts a data URL and a remote https file', () => {
    expect(
      validateKycDocument(passport({ fileContent: `data:application/pdf;base64,${pdf.toString('base64')}` }), NOW).valid,
    ).toBe(true);
    expect(
      validateKycDocument(passport({ fileContent: undefined, fileUrl: 'https://files.example.com/p.pdf' }), NOW).valid,
    ).toBe(true);
  });

  it('accepts a recent proof of address without a document number', () => {
    const result = validateKycDocument(utilityBill(), NOW);
    expect(result.valid).toBe(true);
    expect(result.normalizedDocumentNumber).toBeUndefined();
  });

  it('rejects unsupported MIME types and mismatched extensions', () => {
    expect(validateKycDocument(passport({ mimeType: 'image/gif', fileName: 'p.gif' }), NOW).errors[0]).toMatch(
      /Unsupported file type/,
    );
    expect(validateKycDocument(passport({ fileName: 'passport.png' }), NOW).errors).toContain(
      'File extension ".png" does not match file type application/pdf',
    );
  });

  it('rejects files that are too large or too small', () => {
    expect(
      validateKycDocument(passport({ fileSize: KYC_MAX_FILE_BYTES + 1, fileContent: undefined, fileUrl: 'https://x.io/a.pdf' }), NOW)
        .errors,
    ).toContain('File exceeds the 10 MB limit');
    expect(
      validateKycDocument(passport({ fileSize: 10, fileContent: undefined, fileUrl: 'https://x.io/a.pdf' }), NOW).errors,
    ).toContain('File is too small to be a legible document image');
  });

  it('rejects content that does not match the declared type or size', () => {
    const result = validateKycDocument(passport({ fileContent: png.toString('base64'), fileSize: png.length }), NOW);
    expect(result.errors).toContain('File contents are not a valid application/pdf file');

    const sizeMismatch = validateKycDocument(passport({ fileSize: pdf.length + 5 }), NOW);
    expect(sizeMismatch.errors[0]).toMatch(/does not match uploaded content/);
  });

  it('requires a file and rejects invalid base64 or non-https URLs', () => {
    expect(validateKycDocument(passport({ fileContent: undefined }), NOW).errors).toContain(
      'Either fileContent or fileUrl is required',
    );
    expect(validateKycDocument(passport({ fileContent: 'not base64!' }), NOW).errors).toContain(
      'fileContent must be valid base64',
    );
    expect(
      validateKycDocument(passport({ fileContent: undefined, fileUrl: 'http://files.example.com/p.pdf' }), NOW).errors,
    ).toContain('fileUrl must be an https URL');
  });

  it('rejects identity documents with missing or malformed numbers', () => {
    expect(validateKycDocument(passport({ documentNumber: undefined }), NOW).errors).toContain(
      'Document number is required for identity documents',
    );
    expect(validateKycDocument(passport({ documentNumber: 'AB1' }), NOW).errors).toContain(
      'Document number format is not valid for a DE passport',
    );
    expect(validateKycDocument(passport({ issuingCountry: 'GB', documentNumber: 'X1234567' }), NOW).valid).toBe(false);
  });

  it('rejects expired identity documents and warns when expiry is close', () => {
    expect(validateKycDocument(passport({ expiryDate: '2026-06-15' }), NOW).errors).toContain(
      'Document expired on 2026-06-15',
    );

    const expiringSoon = validateKycDocument(passport({ expiryDate: '2026-07-01' }), NOW);
    expect(expiringSoon.valid).toBe(true);
    expect(expiringSoon.warnings).toEqual(['Document expires within 30 days']);
  });

  it('rejects missing, malformed, and inconsistent identity dates', () => {
    expect(validateKycDocument(passport({ expiryDate: undefined }), NOW).errors).toContain(
      'Expiry date is required for identity documents',
    );
    expect(validateKycDocument(passport({ expiryDate: '2031-02-30' }), NOW).errors).toContain(
      'Expiry date must be a valid date in YYYY-MM-DD format',
    );
    expect(validateKycDocument(passport({ expiryDate: '2060-01-01' }), NOW).errors).toContain(
      'Expiry date is too far in the future',
    );
    expect(validateKycDocument(passport({ issueDate: '2027-01-01' }), NOW).errors).toContain(
      'Issue date cannot be in the future',
    );
  });

  it('rejects stale or undated proof of address', () => {
    expect(validateKycDocument(utilityBill({ issueDate: undefined }), NOW).errors).toContain(
      'Issue date is required for proof-of-address documents',
    );
    expect(validateKycDocument(utilityBill({ issueDate: '2026-01-01' }), NOW).errors).toContain(
      'Proof of address must be issued within the last 90 days',
    );
    expect(validateKycDocument(utilityBill({ issueDate: '2026-07-01' }), NOW).errors).toContain(
      'Issue date cannot be in the future',
    );
  });

  it('rejects unknown document types and bad country codes', () => {
    const result = validateKycDocument(
      passport({ type: 'selfie' as KycDocumentInput['type'], issuingCountry: 'DEU' }),
      NOW,
    );
    expect(result.errors).toContain('Unsupported document type "selfie"');
    expect(result.errors).toContain('Issuing country must be a 2-letter ISO country code');
  });
});

describe('MockDocumentVerificationProvider', () => {
  const provider = new MockDocumentVerificationProvider();
  const base = {
    userId: 'user-1',
    documentId: 'doc-1',
    type: 'passport' as const,
    issuingCountry: 'DE',
    mimeType: 'application/pdf',
  };

  it('approves ordinary documents', async () => {
    const result = await provider.verify({ ...base, documentNumber: 'X1234567' });
    expect(result.decision).toBe('approved');
    expect(result.reasons).toEqual([]);
    expect(result.reference).toMatch(/^mock_/);
  });

  it('rejects numbers ending in 000 with a reason', async () => {
    const result = await provider.verify({ ...base, documentNumber: 'X1234000' });
    expect(result.decision).toBe('rejected');
    expect(result.reasons).toEqual(['Document number is reported as lost or stolen']);
  });

  it('routes numbers ending in 999 to manual review', async () => {
    const result = await provider.verify({ ...base, documentNumber: 'X1234999' });
    expect(result.decision).toBe('needs_review');
  });
});
