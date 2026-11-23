import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';

// Authenticate test callers from headers: x-test-user, x-test-tenant, x-test-role.
vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    const id = req.headers['x-test-user'];
    if (typeof id !== 'string') {
      next(Object.assign(new Error('Authentication required'), { statusCode: 401, code: 'AUTH_REQUIRED' }));
      return;
    }
    req.user = {
      id,
      tenantId: String(req.headers['x-test-tenant'] ?? 'default'),
      role: String(req.headers['x-test-role'] ?? 'user'),
      method: 'session',
    };
    next();
  },
}));

import {
  DocumentVaultError,
  InMemoryEncryptedDocumentStore,
  KycDocumentVault,
  type EncryptedDocumentStore,
} from '../documentVault.js';
import { LocalKms } from '../../services/kms.js';
import { KycError, KycService, kycService, type KycPersonalInfo } from '../../services/kyc.js';
import { auditService } from '../../services/auditService.js';
import { kycRouter } from '../../routes/kyc.js';

const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('PASSPORT P<GBRLOVELACE<<ADA'), Buffer.alloc(2048, 0x20)]);

const person: KycPersonalInfo = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: '1990-04-12',
  nationality: 'GB',
  countryOfResidence: 'GB',
  address: { line1: '1 Main St', city: 'London', postalCode: 'N1 9GU', country: 'GB' },
};

const passport = {
  type: 'passport' as const,
  documentNumber: '123456789',
  issuingCountry: 'GB',
  expiryDate: '2031-01-01',
  fileName: 'passport.pdf',
  mimeType: 'application/pdf',
  fileSize: pdf.length,
  fileContent: pdf.toString('base64'),
};

function vault() {
  const store = new InMemoryEncryptedDocumentStore();
  const kms = new LocalKms({ masterKey: randomBytes(32) });
  return { store, kms, vault: new KycDocumentVault(store, kms) };
}

const reader = (tenantId = 'tenant-a') => ({ tenantId, actor: 'reviewer-1', reason: 'manual review' });

async function vaultCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof DocumentVaultError ? error.code : `unexpected: ${String(error)}`;
  }
  return undefined;
}

describe('KycDocumentVault (#1470)', () => {
  it('stores only ciphertext and returns the original bytes to the owning tenant', async () => {
    const { vault: v, store } = vault();
    const record = await v.put({ tenantId: 'tenant-a', userId: 'u1', documentId: 'd1', mimeType: 'application/pdf', content: pdf });

    const stored = await store.get(record.ref);
    expect(stored).toBeDefined();
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain('PASSPORT');
    expect(Buffer.from(stored!.ciphertext, 'base64').includes(Buffer.from('LOVELACE'))).toBe(false);
    expect(stored).toMatchObject({ alg: 'A256GCM', size: pdf.length, wrappedKey: { tenantId: 'tenant-a', keyVersion: 1 } });

    const read = await v.read(record.ref, reader());
    expect(read.content.equals(pdf)).toBe(true);
    expect(read.record).not.toHaveProperty('ciphertext');
  });

  it('refuses another tenant without unwrapping any key, and audits the attempt', async () => {
    const { vault: v, kms } = vault();
    const record = await v.put({ tenantId: 'tenant-a', userId: 'u1', documentId: 'd1', mimeType: 'application/pdf', content: pdf });
    const unwrap = vi.spyOn(kms, 'decryptDataKey');
    const audit = vi.spyOn(auditService, 'logAction');

    expect(await vaultCode(v.read(record.ref, reader('tenant-b')))).toBe('TENANT_MISMATCH');
    expect(unwrap).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'kyc.document.read_denied', outcome: 'failure' }));
    audit.mockRestore();
  });

  it('audits every successful read with the reader and reason', async () => {
    const { vault: v } = vault();
    const record = await v.put({ tenantId: 'tenant-a', userId: 'u1', documentId: 'd1', mimeType: 'application/pdf', content: pdf });
    const audit = vi.spyOn(auditService, 'logAction');
    await v.read(record.ref, reader());
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'reviewer-1',
        action: 'kyc.document.read',
        resourceId: 'd1',
        details: expect.objectContaining({ reason: 'manual review', subject: 'u1' }),
      }),
    );
    audit.mockRestore();
  });

  it.each([
    ['ciphertext', (r: Record<string, unknown>) => ({ ...r, ciphertext: Buffer.from('tampered').toString('base64') })],
    ['metadata bound as AAD', (r: Record<string, unknown>) => ({ ...r, mimeType: 'text/html' })],
    ['document ID bound as AAD', (r: Record<string, unknown>) => ({ ...r, documentId: 'd2' })],
  ])('detects tampering with the %s', async (_name, tamper) => {
    const { vault: v, store } = vault();
    const record = await v.put({ tenantId: 'tenant-a', userId: 'u1', documentId: 'd1', mimeType: 'application/pdf', content: pdf });
    await store.put(tamper(record as unknown as Record<string, unknown>) as never);
    expect(await vaultCode(v.read(record.ref, reader()))).toMatch(/INTEGRITY|UNAVAILABLE/);
  });

  it('rejects a wrapped key swapped in from another document', async () => {
    const { vault: v, store } = vault();
    const a = await v.put({ tenantId: 'tenant-a', userId: 'u1', documentId: 'd1', mimeType: 'application/pdf', content: pdf });
    const b = await v.put({ tenantId: 'tenant-a', userId: 'u2', documentId: 'd2', mimeType: 'application/pdf', content: pdf });
    await store.put({ ...a, wrappedKey: b.wrappedKey });
    expect(await vaultCode(v.read(a.ref, reader()))).toBe('UNAVAILABLE');
  });

  it('rotates the tenant key and rewraps stored documents without re-encrypting them', async () => {
    const { vault: v, store } = vault();
    const record = await v.put({ tenantId: 'tenant-a', userId: 'u1', documentId: 'd1', mimeType: 'application/pdf', content: pdf });
    await v.put({ tenantId: 'tenant-b', userId: 'u2', documentId: 'd2', mimeType: 'application/pdf', content: pdf });

    expect(await v.rotateTenant('tenant-a')).toEqual({ version: 2, rewrapped: 1 });
    const after = await store.get(record.ref);
    expect(after?.wrappedKey.keyVersion).toBe(2);
    expect(after?.ciphertext).toBe(record.ciphertext);
    expect((await v.read(record.ref, reader())).content.equals(pdf)).toBe(true);
  });

  it('shreds a tenant: its documents are gone and other tenants are untouched', async () => {
    const { vault: v } = vault();
    const a = await v.put({ tenantId: 'tenant-a', userId: 'u1', documentId: 'd1', mimeType: 'application/pdf', content: pdf });
    const b = await v.put({ tenantId: 'tenant-b', userId: 'u2', documentId: 'd2', mimeType: 'application/pdf', content: pdf });

    expect(await v.shredTenant('tenant-a')).toBe(1);
    expect(await vaultCode(v.read(a.ref, reader()))).toBe('NOT_FOUND');
    expect((await v.read(b.ref, reader('tenant-b'))).content.equals(pdf)).toBe(true);
  });

  it('reports a destroyed key distinctly when ciphertext outlives its key (e.g. a backup restore)', async () => {
    const { vault: v, kms } = vault();
    const record = await v.put({ tenantId: 'tenant-a', userId: 'u1', documentId: 'd1', mimeType: 'application/pdf', content: pdf });
    await kms.destroyTenantKey('tenant-a');
    expect(await vaultCode(v.read(record.ref, reader()))).toBe('KEY_DESTROYED');
  });

  it('counts vault operations', async () => {
    const { vault: v } = vault();
    const record = await v.put({ tenantId: 'tenant-a', userId: 'u1', documentId: 'd1', mimeType: 'application/pdf', content: pdf });
    await v.read(record.ref, reader());
    await v.read(record.ref, reader('tenant-b')).catch(() => undefined);
    expect(v.stats()).toEqual({ encrypted: 1, decrypted: 1, denied_tenant: 1 });
  });
});

describe('KYC uploads are encrypted at rest', () => {
  let service: KycService;
  let v: KycDocumentVault;
  let store: InMemoryEncryptedDocumentStore;

  beforeEach(() => {
    ({ vault: v, store } = vault());
    service = new KycService({ documentVault: v });
    service.savePersonalInfo('u1', person, 'tenant-a');
  });

  it('keeps only a vault reference on the document', async () => {
    const document = await service.uploadDocument('u1', passport);
    expect(document.encryptedAtRest).toBe(true);
    expect(document.storageRef).toMatch(/^kycdoc_/);
    expect(JSON.stringify(service.getOnboardingState('u1'))).not.toContain(passport.fileContent.slice(0, 40));

    const { content } = await service.readDocumentContent('u1', document.id, reader());
    expect(content.equals(pdf)).toBe(true);
  });

  it('hides documents from reviewers of another tenant', async () => {
    const document = await service.uploadDocument('u1', passport);
    await expect(service.readDocumentContent('u1', document.id, reader('tenant-b'))).rejects.toMatchObject({
      code: 'KYC_DOCUMENT_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('does not let another tenant take over an applicant profile', () => {
    expect(() => service.savePersonalInfo('u1', person, 'tenant-b')).toThrow(KycError);
  });

  it('deletes the old encrypted file when a document is replaced', async () => {
    const first = await service.uploadDocument('u1', passport);
    await service.uploadDocument('u1', passport);
    await new Promise((resolve) => setImmediate(resolve));
    expect(await store.get(first.storageRef!)).toBeUndefined();
    expect(await store.listByTenant('tenant-a')).toHaveLength(1);
  });

  it('fails the upload rather than keeping an unencrypted file when the vault is down', async () => {
    const broken: EncryptedDocumentStore = { ...store, put: async () => Promise.reject(new Error('disk full')) } as never;
    const failing = new KycService({ documentVault: new KycDocumentVault(broken, new LocalKms({ masterKey: randomBytes(32) })) });
    failing.savePersonalInfo('u1', person, 'tenant-a');
    await expect(failing.uploadDocument('u1', passport)).rejects.toMatchObject({ code: 'DOCUMENT_STORAGE_UNAVAILABLE', statusCode: 503 });
    expect(failing.getOnboardingState('u1')?.profile.documents).toHaveLength(0);
  });

  it('answers 410 once the tenant has been shredded', async () => {
    const document = await service.uploadDocument('u1', passport);
    const kms = (v as unknown as { kmsProvider: LocalKms }).kmsProvider;
    await kms.destroyTenantKey('tenant-a');
    await expect(service.readDocumentContent('u1', document.id, reader())).rejects.toMatchObject({ code: 'KYC_DOCUMENT_ERASED', statusCode: 410 });
  });
});

describe('GET /kyc/:userId/documents/:documentId/content', () => {
  let server: Server;
  let base: string;
  let documentId: string;
  const userId = `route-user-${Date.now()}`;

  beforeEach(async () => {
    kycService.savePersonalInfo(userId, person, 'tenant-a');
    documentId = (await kycService.uploadDocument(userId, passport)).id;

    const app = express();
    app.use(express.json());
    app.use('/kyc', kycRouter);
    app.use((err: { statusCode?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.statusCode ?? 500).json({ code: err.code });
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    base = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const get = (headers: Record<string, string>) => fetch(`${base}/kyc/${userId}/documents/${documentId}/content`, { headers });

  it('returns the decrypted file to a compliance reviewer of the same tenant', async () => {
    const res = await get({ 'x-test-user': 'rev-1', 'x-test-tenant': 'tenant-a', 'x-test-role': 'compliance' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="passport.pdf"');
    expect(Buffer.from(await res.arrayBuffer()).equals(pdf)).toBe(true);
  });

  it('requires authentication', async () => {
    expect((await get({})).status).toBe(401);
  });

  it('requires a reviewer role', async () => {
    const res = await get({ 'x-test-user': 'u', 'x-test-tenant': 'tenant-a', 'x-test-role': 'user' });
    expect(res.status).toBe(403);
  });

  it('does not reveal documents to another tenant, even to its admins', async () => {
    const res = await get({ 'x-test-user': 'rev-2', 'x-test-tenant': 'tenant-b', 'x-test-role': 'admin' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'KYC_DOCUMENT_NOT_FOUND' });
  });
});
