import express, { type Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { kycRouter } from '../kyc.js';
import { errorHandler } from '../../middleware/errorHandler.js';

// Vitest resolves these `.js` specifiers to the stale compiled CommonJS files
// that sit next to the middleware sources; use the TypeScript implementations
// that the build actually ships.
vi.mock('../../middleware/errorHandler.js', () => import('../../middleware/errorHandler.ts'));
vi.mock('../../middleware/validate.js', () => import('../../middleware/validate.ts'));

let server: import('node:http').Server;
let base = '';

const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4096, 0x20)]);

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const personalInfo = {
  firstName: 'Grace',
  lastName: 'Hopper',
  dateOfBirth: '1985-12-09',
  nationality: 'us',
  countryOfResidence: 'US',
  address: { line1: '1 Navy Way', city: 'Arlington', state: 'VA', postalCode: '22202', country: 'US' },
};

function passport(documentNumber: string) {
  return {
    type: 'passport',
    documentNumber,
    issuingCountry: 'US',
    expiryDate: isoDaysFromNow(365 * 5),
    fileName: 'passport.pdf',
    mimeType: 'application/pdf',
    fileSize: pdf.length,
    fileContent: pdf.toString('base64'),
  };
}

const utilityBill = {
  type: 'utility_bill',
  issuingCountry: 'US',
  issueDate: isoDaysFromNow(-10),
  fileName: 'bill.pdf',
  mimeType: 'application/pdf',
  fileSize: pdf.length,
  fileContent: pdf.toString('base64'),
};

interface ErrorBody {
  error: { code: string; message: string; details?: string[] };
}

async function call<T = unknown>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as T) : (undefined as T),
  };
}

describe('kyc http api', () => {
  beforeAll(async () => {
    const app: Express = express();
    app.use('/api/v1/kyc', express.json({ limit: '15mb' }));
    app.use('/api/v1/kyc', kycRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('GET /requirements describes the document rules', async () => {
    const res = await call<{ allowedMimeTypes: string[]; maxFileBytes: number; identityDocumentTypes: string[] }>(
      'GET',
      '/api/v1/kyc/requirements',
    );
    expect(res.status).toBe(200);
    expect(res.body.allowedMimeTypes).toContain('application/pdf');
    expect(res.body.maxFileBytes).toBe(10 * 1024 * 1024);
    expect(res.body.identityDocumentTypes).toEqual(['passport', 'drivers_license', 'national_id']);
  });

  it('GET /:userId returns 404 before onboarding starts', async () => {
    const res = await call<ErrorBody>('GET', '/api/v1/kyc/nobody');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('KYC_NOT_FOUND');
  });

  it('runs the full onboarding flow to an automatic approval', async () => {
    const info = await call<{ profile: { status: string; onboardingStep: string } }>(
      'PUT',
      '/api/v1/kyc/user-flow/personal-info',
      personalInfo,
    );
    expect(info.status).toBe(200);
    expect(info.body.profile.status).toBe('pending');
    expect(info.body.profile.onboardingStep).toBe('documents');

    const id = await call<{ document: { status: string; documentNumberMasked: string } }>(
      'POST',
      '/api/v1/kyc/user-flow/documents',
      passport('A12345678'),
    );
    expect(id.status).toBe(201);
    expect(id.body.document.status).toBe('approved');
    expect(id.body.document.documentNumberMasked).toBe('*****5678');

    const address = await call<{ state: { canSubmit: boolean } }>(
      'POST',
      '/api/v1/kyc/user-flow/documents',
      utilityBill,
    );
    expect(address.status).toBe(201);
    expect(address.body.state.canSubmit).toBe(true);

    const submitted = await call<{ profile: { status: string; onboardingStep: string } }>(
      'POST',
      '/api/v1/kyc/user-flow/submit',
    );
    expect(submitted.status).toBe(200);
    expect(submitted.body.profile.status).toBe('approved');
    expect(submitted.body.profile.onboardingStep).toBe('complete');
  });

  it('rejects malformed personal info with field-level errors', async () => {
    const res = await call<{ error: string; details: Array<{ path: string }> }>(
      'PUT',
      '/api/v1/kyc/user-bad/personal-info',
      { ...personalInfo, nationality: 'USA', dateOfBirth: '09/12/1985' },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(res.body.details.map((d) => d.path)).toEqual(expect.arrayContaining(['nationality', 'dateOfBirth']));
  });

  it('rejects underage applicants with a reason', async () => {
    const res = await call<ErrorBody>('PUT', '/api/v1/kyc/user-young/personal-info', {
      ...personalInfo,
      dateOfBirth: isoDaysFromNow(-365 * 10),
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_PERSONAL_INFO');
    expect(res.body.error.details).toEqual(['Applicant must be at least 18 years old']);
  });

  it('returns validation reasons for an invalid document', async () => {
    await call('PUT', '/api/v1/kyc/user-doc/personal-info', personalInfo);

    const res = await call<ErrorBody>('POST', '/api/v1/kyc/user-doc/documents', {
      ...passport('BAD'),
      expiryDate: isoDaysFromNow(-1),
      mimeType: 'image/png',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_DOCUMENT');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        'File extension ".pdf" does not match file type image/png',
        'File contents are not a valid image/png file',
        'Document number format is not valid for a US passport',
        `Document expired on ${isoDaysFromNow(-1)}`,
      ]),
    );
  });

  it('requires a file source for document uploads', async () => {
    const withoutFile: Partial<ReturnType<typeof passport>> = passport('A12345678');
    delete withoutFile.fileContent;
    const res = await call<{ error: string; details: Array<{ path: string }> }>(
      'POST',
      '/api/v1/kyc/user-doc/documents',
      withoutFile,
    );
    expect(res.status).toBe(400);
    expect(res.body.details[0].path).toBe('fileContent');
  });

  it('blocks submission until requirements are met', async () => {
    await call('PUT', '/api/v1/kyc/user-partial/personal-info', personalInfo);
    const res = await call<ErrorBody>('POST', '/api/v1/kyc/user-partial/submit');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REQUIREMENTS_NOT_MET');
    expect(res.body.error.details).toHaveLength(2);
  });

  it('supports the manual review queue with rejection reasons', async () => {
    await call('PUT', '/api/v1/kyc/user-review/personal-info', personalInfo);
    const flagged = await call<{ document: { id: string; status: string } }>(
      'POST',
      '/api/v1/kyc/user-review/documents',
      passport('B12345999'),
    );
    expect(flagged.body.document.status).toBe('pending');
    await call('POST', '/api/v1/kyc/user-review/documents', utilityBill);

    const submitted = await call<{ profile: { status: string } }>('POST', '/api/v1/kyc/user-review/submit');
    expect(submitted.body.profile.status).toBe('under_review');

    const queue = await call<{ items: Array<{ userId: string }> }>('GET', '/api/v1/kyc/review/queue');
    expect(queue.body.items.map((p) => p.userId)).toContain('user-review');

    const missingReason = await call<{ error: string }>('POST', '/api/v1/kyc/user-review/review', {
      decision: 'rejected',
      reviewerId: 'admin-1',
    });
    expect(missingReason.status).toBe(400);

    const docReview = await call<{ status: string; rejectionReasons: string[] }>(
      'POST',
      `/api/v1/kyc/user-review/documents/${flagged.body.document.id}/review`,
      { approved: false, reasons: ['Photo page is cropped'] },
    );
    expect(docReview.status).toBe(200);
    expect(docReview.body.status).toBe('rejected');

    const rejected = await call<{ profile: { status: string; rejectionReasons: string[] } }>(
      'POST',
      '/api/v1/kyc/user-review/review',
      { decision: 'rejected', reviewerId: 'admin-1', reasons: ['Photo page is cropped'] },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.profile.status).toBe('rejected');
    expect(rejected.body.profile.rejectionReasons).toEqual(['Photo page is cropped']);

    const again = await call<ErrorBody>('POST', '/api/v1/kyc/user-review/review', {
      decision: 'approved',
      reviewerId: 'admin-1',
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });
});
