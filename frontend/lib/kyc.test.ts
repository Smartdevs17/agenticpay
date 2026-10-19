import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KYC_MAX_FILE_BYTES,
  KycApiError,
  kycApi,
  parseIsoDate,
  readFileAsBase64,
  validateDocumentFile,
  validateDocumentForm,
  validatePersonalInfo,
  type KycDocumentForm,
  type KycPersonalInfo,
} from '@/lib/kyc';

const NOW = new Date('2026-06-15T12:00:00.000Z');

const person: KycPersonalInfo = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: '1990-04-12',
  nationality: 'GB',
  countryOfResidence: 'GB',
  address: { line1: '1 Main St', city: 'London', postalCode: 'N1 9GU', country: 'GB' },
};

const passportForm: KycDocumentForm = {
  type: 'passport',
  documentNumber: '123456789',
  issuingCountry: 'GB',
  issueDate: '',
  expiryDate: '2030-01-01',
};

function makeFile(size: number, type = 'application/pdf', name = 'doc.pdf'): File {
  return new File([new Uint8Array(size)], name, { type });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseIsoDate', () => {
  it('accepts real calendar dates only', () => {
    expect(parseIsoDate('2024-02-29')).toBeInstanceOf(Date);
    expect(parseIsoDate('2023-02-29')).toBeUndefined();
    expect(parseIsoDate('')).toBeUndefined();
  });
});

describe('validatePersonalInfo', () => {
  it('returns no errors for a complete adult profile', () => {
    expect(validatePersonalInfo(person, NOW)).toEqual({});
  });

  it('flags missing fields, bad country codes, and underage applicants', () => {
    const errors = validatePersonalInfo(
      {
        ...person,
        firstName: ' ',
        dateOfBirth: '2012-01-01',
        nationality: 'GBR',
        address: { ...person.address, city: '', country: 'x' },
      },
      NOW,
    );

    expect(errors).toEqual({
      firstName: 'First name is required',
      dateOfBirth: 'You must be at least 18 years old',
      nationality: 'Use a 2-letter country code, e.g. US',
      'address.city': 'City is required',
      'address.country': 'Use a 2-letter country code, e.g. US',
    });
  });

  it('rejects a future date of birth', () => {
    expect(validatePersonalInfo({ ...person, dateOfBirth: '2030-01-01' }, NOW).dateOfBirth).toBe(
      'Date of birth cannot be in the future',
    );
  });
});

describe('validateDocumentFile', () => {
  it('accepts supported files within the size limits', () => {
    expect(validateDocumentFile(makeFile(4096))).toBeUndefined();
    expect(validateDocumentFile(makeFile(4096, 'image/png', 'id.png'))).toBeUndefined();
  });

  it('rejects missing, unsupported, oversized, and tiny files', () => {
    expect(validateDocumentFile(null)).toBe('Choose a file to upload');
    expect(validateDocumentFile(makeFile(4096, 'image/gif', 'id.gif'))).toBe('Upload a JPEG, PNG, WebP, or PDF file');
    expect(validateDocumentFile(makeFile(KYC_MAX_FILE_BYTES + 1))).toBe('File must be 10 MB or smaller');
    expect(validateDocumentFile(makeFile(100))).toBe('File is too small to be a legible document');
  });
});

describe('validateDocumentForm', () => {
  it('accepts a valid identity document', () => {
    expect(validateDocumentForm(passportForm, makeFile(4096), NOW)).toEqual({});
  });

  it('requires a number and a future expiry for identity documents', () => {
    expect(validateDocumentForm({ ...passportForm, documentNumber: '', expiryDate: '2026-06-01' }, makeFile(4096), NOW)).toEqual({
      documentNumber: 'Document number is required',
      expiryDate: 'This document has expired',
    });
    expect(validateDocumentForm({ ...passportForm, documentNumber: 'AB#12' }, makeFile(4096), NOW).documentNumber).toBe(
      'Use letters and digits only',
    );
  });

  it('requires a recent issue date for proof of address', () => {
    const bill: KycDocumentForm = { ...passportForm, type: 'utility_bill', documentNumber: '', expiryDate: '' };

    expect(validateDocumentForm({ ...bill, issueDate: '2026-06-01' }, makeFile(4096), NOW)).toEqual({});
    expect(validateDocumentForm(bill, makeFile(4096), NOW).issueDate).toBe('Enter the issue date');
    expect(validateDocumentForm({ ...bill, issueDate: '2026-01-01' }, makeFile(4096), NOW).issueDate).toBe(
      'Must be issued within the last 90 days',
    );
    expect(validateDocumentForm({ ...bill, issueDate: '2026-07-01' }, makeFile(4096), NOW).issueDate).toBe(
      'Issue date cannot be in the future',
    );
  });

  it('includes file problems alongside field errors', () => {
    expect(validateDocumentForm({ ...passportForm, issuingCountry: '' }, null, NOW)).toEqual({
      issuingCountry: 'Use a 2-letter country code, e.g. US',
      file: 'Choose a file to upload',
    });
  });
});

describe('readFileAsBase64', () => {
  it('returns the base64 payload without the data URL prefix', async () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    await expect(readFileAsBase64(file)).resolves.toBe(btoa('hello'));
  });
});

describe('kycApi', () => {
  it('returns null when the applicant has not started onboarding', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(404, { error: { code: 'KYC_NOT_FOUND', message: 'KYC profile not found', status: 404 } }),
    );
    await expect(kycApi.getState('user-1')).resolves.toBeNull();
  });

  it('surfaces service error details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(422, {
        error: { code: 'INVALID_DOCUMENT', message: 'Document failed validation', details: ['Document expired on 2026-01-01'] },
      }),
    );

    const error = await kycApi.submit('user-1').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(KycApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 'INVALID_DOCUMENT',
      details: ['Document expired on 2026-01-01'],
    });
  });

  it('surfaces request validation errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(400, {
        error: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: [{ path: 'nationality', message: 'Use a 2-letter ISO country code' }],
      }),
    );

    const error = await kycApi.savePersonalInfo('user-1', person).catch((err: unknown) => err);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      details: ['nationality: Use a 2-letter ISO country code'],
    });
  });

  it('sends uploads as JSON to the user-scoped endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(201, { document: {}, state: {} }));

    await kycApi.uploadDocument('user/1', {
      type: 'passport',
      issuingCountry: 'GB',
      documentNumber: '123456789',
      expiryDate: '2030-01-01',
      fileName: 'p.pdf',
      mimeType: 'application/pdf',
      fileSize: 4,
      fileContent: 'AAAA',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/kyc\/user%2F1\/documents$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({ type: 'passport', fileContent: 'AAAA' });
  });
});
