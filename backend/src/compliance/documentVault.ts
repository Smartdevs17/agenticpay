/**
 * Encrypted storage for KYC document files (#1470).
 *
 * Identity documents (passports, licences, bank statements) are the most
 * sensitive data the platform holds. Their bytes are only ever stored here,
 * encrypted with AES-256-GCM under a per-document data key that is wrapped by
 * the owning tenant's key in the KMS (`services/kms.ts`).
 *
 * The additional authenticated data binds each ciphertext to its tenant, user,
 * document ID, MIME type and plaintext digest, so a blob moved to another
 * record or tenant fails to decrypt rather than disclosing the wrong file.
 * Reads check that the caller's tenant owns the document before any key is
 * unwrapped, verify the digest after decryption, and are written to the audit
 * log with the reviewer and their reason.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { auditService } from '../services/auditService.js';
import { createModuleLogger } from '../middleware/logger.js';
import { getKms, KmsError, type EncryptionContext, type KmsProvider, type WrappedDataKey } from '../services/kms.js';

const log = createModuleLogger('kyc-document-vault');

export interface EncryptedDocumentRecord {
  ref: string;
  tenantId: string;
  userId: string;
  documentId: string;
  mimeType: string;
  size: number;
  /** SHA-256 of the plaintext, hex. */
  sha256: string;
  alg: 'A256GCM';
  iv: string;
  tag: string;
  ciphertext: string;
  wrappedKey: WrappedDataKey;
  createdAt: string;
  rewrappedAt?: string;
}

/** Where encrypted blobs live. Implementations only ever see ciphertext. */
export interface EncryptedDocumentStore {
  put(record: EncryptedDocumentRecord): Promise<void>;
  get(ref: string): Promise<EncryptedDocumentRecord | undefined>;
  delete(ref: string): Promise<boolean>;
  listByTenant(tenantId: string): Promise<EncryptedDocumentRecord[]>;
}

export class InMemoryEncryptedDocumentStore implements EncryptedDocumentStore {
  private readonly records = new Map<string, EncryptedDocumentRecord>();

  async put(record: EncryptedDocumentRecord) {
    this.records.set(record.ref, { ...record });
  }

  async get(ref: string) {
    const record = this.records.get(ref);
    return record ? { ...record } : undefined;
  }

  async delete(ref: string) {
    return this.records.delete(ref);
  }

  async listByTenant(tenantId: string) {
    return [...this.records.values()].filter((r) => r.tenantId === tenantId).map((r) => ({ ...r }));
  }
}

export class DocumentVaultError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'TENANT_MISMATCH' | 'KEY_DESTROYED' | 'INTEGRITY' | 'UNAVAILABLE',
  ) {
    super(message);
    this.name = 'DocumentVaultError';
  }
}

export interface StoreDocumentInput {
  tenantId: string;
  userId: string;
  documentId: string;
  mimeType: string;
  content: Buffer;
}

export interface ReadAccess {
  /** Tenant of the caller; must own the document. */
  tenantId: string;
  /** Who is reading, for the audit trail. */
  actor: string;
  reason?: string;
}

export interface DecryptedDocument {
  record: Omit<EncryptedDocumentRecord, 'iv' | 'tag' | 'ciphertext' | 'wrappedKey'>;
  content: Buffer;
}

function contextFor(r: Pick<EncryptedDocumentRecord, 'tenantId' | 'userId' | 'documentId' | 'ref'>): EncryptionContext {
  return { purpose: 'kyc-document', tenant: r.tenantId, user: r.userId, document: r.documentId, ref: r.ref };
}

function aadFor(r: Pick<EncryptedDocumentRecord, 'tenantId' | 'userId' | 'documentId' | 'ref' | 'mimeType' | 'sha256'>): Buffer {
  return Buffer.from(
    ['agenticpay-kyc-doc/v1', r.tenantId, r.userId, r.documentId, r.ref, r.mimeType, r.sha256].map(encodeURIComponent).join('|'),
    'utf8',
  );
}

export class KycDocumentVault {
  private readonly counters = new Map<string, number>();

  constructor(
    private readonly store: EncryptedDocumentStore = new InMemoryEncryptedDocumentStore(),
    private readonly kmsProvider?: KmsProvider,
  ) {}

  private get kms(): KmsProvider {
    return this.kmsProvider ?? getKms();
  }

  /** Encrypt and store a document file; returns the stored record (no plaintext). */
  async put(input: StoreDocumentInput): Promise<EncryptedDocumentRecord> {
    const ref = `kycdoc_${randomUUID()}`;
    const sha256 = createHash('sha256').update(input.content).digest('hex');
    const base = {
      ref,
      tenantId: input.tenantId,
      userId: input.userId,
      documentId: input.documentId,
      mimeType: input.mimeType,
      sha256,
    };

    const dataKey = await this.kms.generateDataKey(input.tenantId, contextFor(base));
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', dataKey.plaintext, iv);
      cipher.setAAD(aadFor(base));
      const ciphertext = Buffer.concat([cipher.update(input.content), cipher.final()]);
      const record: EncryptedDocumentRecord = {
        ...base,
        size: input.content.length,
        alg: 'A256GCM',
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        wrappedKey: dataKey.wrapped,
        createdAt: new Date().toISOString(),
      };
      await this.store.put(record);
      this.observe('encrypted');
      log.info(
        { ref, tenantId: input.tenantId, documentId: input.documentId, size: record.size, keyVersion: dataKey.wrapped.keyVersion },
        'KYC document encrypted at rest',
      );
      return record;
    } finally {
      dataKey.plaintext.fill(0);
    }
  }

  /** Decrypt a document for an authorised reader of the owning tenant. Audited. */
  async read(ref: string, access: ReadAccess): Promise<DecryptedDocument> {
    const record = await this.store.get(ref);
    if (!record) throw new DocumentVaultError('Document not found', 'NOT_FOUND');
    if (record.tenantId !== access.tenantId) {
      this.observe('denied_tenant');
      log.warn({ ref, actor: access.actor, ownerTenant: record.tenantId, callerTenant: access.tenantId }, 'Cross-tenant KYC document read refused');
      void auditService.logAction({
        userId: access.actor,
        action: 'kyc.document.read_denied',
        resource: 'kyc_document',
        resourceId: record.documentId,
        outcome: 'failure',
        details: { reason: 'tenant_mismatch', callerTenant: access.tenantId },
      });
      // Same answer as a missing document, so refs cannot be probed across tenants.
      throw new DocumentVaultError('Document not found', 'TENANT_MISMATCH');
    }

    let key: Buffer;
    try {
      key = await this.kms.decryptDataKey(record.wrappedKey, contextFor(record));
    } catch (error) {
      if (error instanceof KmsError && error.code === 'KEY_DESTROYED') {
        this.observe('shredded');
        throw new DocumentVaultError('Document key has been destroyed', 'KEY_DESTROYED');
      }
      this.observe('key_error');
      log.error({ ref, err: error }, 'KYC document key unavailable');
      throw new DocumentVaultError('Document key unavailable', 'UNAVAILABLE');
    }

    let content: Buffer;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
      decipher.setAAD(aadFor(record));
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      content = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]);
    } catch {
      this.observe('integrity_failure');
      log.error({ ref, tenantId: record.tenantId }, 'KYC document failed authentication');
      throw new DocumentVaultError('Document failed integrity check', 'INTEGRITY');
    } finally {
      key.fill(0);
    }

    if (createHash('sha256').update(content).digest('hex') !== record.sha256) {
      this.observe('integrity_failure');
      throw new DocumentVaultError('Document failed integrity check', 'INTEGRITY');
    }

    this.observe('decrypted');
    void auditService.logAction({
      userId: access.actor,
      action: 'kyc.document.read',
      resource: 'kyc_document',
      resourceId: record.documentId,
      outcome: 'success',
      details: { ref, tenantId: record.tenantId, subject: record.userId, reason: access.reason },
    });

    return {
      record: {
        ref: record.ref,
        tenantId: record.tenantId,
        userId: record.userId,
        documentId: record.documentId,
        mimeType: record.mimeType,
        size: record.size,
        sha256: record.sha256,
        alg: record.alg,
        createdAt: record.createdAt,
        rewrappedAt: record.rewrappedAt,
      },
      content,
    };
  }

  async delete(ref: string): Promise<boolean> {
    const removed = await this.store.delete(ref);
    if (removed) this.observe('deleted');
    return removed;
  }

  /**
   * Rotate the tenant key and move every stored document's data key to the
   * new version. Ciphertext is untouched; only the small wrapped keys change.
   */
  async rotateTenant(tenantId: string): Promise<{ version: number; rewrapped: number }> {
    const version = await this.kms.rotateTenantKey(tenantId);
    let rewrapped = 0;
    for (const record of await this.store.listByTenant(tenantId)) {
      if (record.wrappedKey.keyVersion === version) continue;
      const wrappedKey = await this.kms.rewrapDataKey(record.wrappedKey, contextFor(record));
      await this.store.put({ ...record, wrappedKey, rewrappedAt: new Date().toISOString() });
      rewrapped += 1;
    }
    log.info({ tenantId, version, rewrapped }, 'KYC document keys rotated');
    return { version, rewrapped };
  }

  /** Destroy the tenant key: every document of the tenant becomes permanently unreadable. */
  async shredTenant(tenantId: string): Promise<number> {
    await this.kms.destroyTenantKey(tenantId);
    const records = await this.store.listByTenant(tenantId);
    for (const record of records) await this.store.delete(record.ref);
    this.observe('shredded_tenant');
    void auditService.logAction({
      action: 'kyc.document.tenant_shredded',
      resource: 'kyc_document',
      resourceId: tenantId,
      outcome: 'success',
      details: { documents: records.length },
    });
    return records.length;
  }

  /** Whether documents survive a restart (false when the KMS uses an ephemeral key). */
  get durable(): boolean {
    return this.kms.durable;
  }

  stats(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  private observe(outcome: string): void {
    this.counters.set(outcome, (this.counters.get(outcome) ?? 0) + 1);
  }
}

export const kycDocumentVault = new KycDocumentVault();
