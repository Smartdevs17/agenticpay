/**
 * Key management for data encrypted at rest with per-tenant keys (#1470).
 *
 * Envelope encryption, three levels:
 *
 *   master key (KMS_MASTER_KEY, or a cloud KMS)
 *     └─ tenant key-encryption key (KEK), one active version per tenant
 *          └─ data key (DEK), one per stored object, used for AES-256-GCM
 *
 * Every object gets a fresh random DEK. The DEK is wrapped by the tenant's
 * active KEK, and only the wrapped form is stored next to the ciphertext. KEKs
 * are random (not derived from the master key), stored wrapped by the master
 * key, and versioned:
 *
 *  - rotateTenantKey() adds a new active version; older versions keep
 *    decrypting, and rewrapDataKey() moves a DEK to the active version without
 *    touching the object's ciphertext.
 *  - destroyTenantKey() erases every version of a tenant's KEK. Their data
 *    keys can then never be unwrapped again (crypto-shredding, e.g. for an
 *    erasure request or tenant offboarding).
 *
 * Wrapping binds the tenant, KEK version and a caller-supplied encryption
 * context as AES-GCM additional data, so a wrapped key copied to another
 * tenant or another object fails to unwrap instead of decrypting someone
 * else's data.
 *
 * `LocalKms` keeps tenant KEKs in a `TenantKeyStore` (in memory by default).
 * A deployment on AWS KMS / GCP KMS / Vault Transit implements `KmsProvider`
 * instead; callers only depend on the interface.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createModuleLogger } from '../middleware/logger.js';

const log = createModuleLogger('kms');

const KEY_BYTES = 32;
const IV_BYTES = 12;
const ALG = 'aes-256-gcm';

/** Key-value pairs bound to a wrapped key; the same context is required to unwrap it. */
export type EncryptionContext = Record<string, string>;

export interface WrappedDataKey {
  /** `local` for LocalKms; other providers use their own name. */
  provider: string;
  tenantId: string;
  keyVersion: number;
  /** base64 */
  iv: string;
  /** base64 */
  tag: string;
  /** base64 */
  ciphertext: string;
}

export interface DataKey {
  /** 32-byte AES key. Callers must `fill(0)` it once done. */
  plaintext: Buffer;
  wrapped: WrappedDataKey;
}

export interface KmsProvider {
  readonly name: string;
  /** False when keys would not survive a restart (development fallback). */
  readonly durable: boolean;
  generateDataKey(tenantId: string, context: EncryptionContext): Promise<DataKey>;
  decryptDataKey(wrapped: WrappedDataKey, context: EncryptionContext): Promise<Buffer>;
  /** Re-wrap under the tenant's active key version. The data key never leaves the KMS boundary. */
  rewrapDataKey(wrapped: WrappedDataKey, context: EncryptionContext): Promise<WrappedDataKey>;
  rotateTenantKey(tenantId: string): Promise<number>;
  destroyTenantKey(tenantId: string): Promise<void>;
  activeKeyVersion(tenantId: string): Promise<number | undefined>;
}

export class KmsError extends Error {
  constructor(
    message: string,
    readonly code: 'KEY_DESTROYED' | 'KEY_NOT_FOUND' | 'UNWRAP_FAILED' | 'INVALID_TENANT' | 'MISCONFIGURED',
  ) {
    super(message);
    this.name = 'KmsError';
  }
}

// ── Tenant key storage ───────────────────────────────────────────────────────

export interface TenantKeyRecord {
  tenantId: string;
  version: number;
  state: 'active' | 'retired';
  /** KEK sealed by the master key (base64 iv.tag.ciphertext). */
  sealed: string;
  createdAt: string;
}

export interface TenantKeyStore {
  list(tenantId: string): Promise<TenantKeyRecord[]>;
  put(record: TenantKeyRecord): Promise<void>;
  /** Remove every version for the tenant; returns how many were removed. */
  deleteTenant(tenantId: string): Promise<number>;
  /** Tenants whose keys were destroyed, so that requests to re-create them can be refused. */
  markDestroyed(tenantId: string): Promise<void>;
  isDestroyed(tenantId: string): Promise<boolean>;
}

export class InMemoryTenantKeyStore implements TenantKeyStore {
  private readonly records = new Map<string, TenantKeyRecord[]>();
  private readonly destroyed = new Set<string>();

  async list(tenantId: string) {
    return [...(this.records.get(tenantId) ?? [])];
  }

  async put(record: TenantKeyRecord) {
    const list = (this.records.get(record.tenantId) ?? []).filter((r) => r.version !== record.version);
    list.push(record);
    list.sort((a, b) => a.version - b.version);
    this.records.set(record.tenantId, list);
  }

  async deleteTenant(tenantId: string) {
    const count = this.records.get(tenantId)?.length ?? 0;
    this.records.delete(tenantId);
    return count;
  }

  async markDestroyed(tenantId: string) {
    this.destroyed.add(tenantId);
  }

  async isDestroyed(tenantId: string) {
    return this.destroyed.has(tenantId);
  }
}

// ── Local provider ───────────────────────────────────────────────────────────

function canonicalContext(context: EncryptionContext): string {
  return Object.keys(context)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(context[k])}`)
    .join('&');
}

function wrapAad(tenantId: string, version: number, context: EncryptionContext): Buffer {
  return Buffer.from(`agenticpay-kms/v1|tenant=${encodeURIComponent(tenantId)}|kek=${version}|${canonicalContext(context)}`, 'utf8');
}

function gcmEncrypt(key: Buffer, plaintext: Buffer, aad: Buffer) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function gcmDecrypt(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer, aad: Buffer): Buffer {
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

const TENANT_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function assertTenant(tenantId: string): void {
  if (!TENANT_ID.test(tenantId)) throw new KmsError('Invalid tenant id', 'INVALID_TENANT');
}

/** Parse `KMS_MASTER_KEY`: 64 hex characters or base64 of 32 bytes. */
export function parseMasterKey(value: string): Buffer {
  const raw = value.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) throw new KmsError('KMS_MASTER_KEY must be 32 bytes (64 hex chars or base64)', 'MISCONFIGURED');
  return key;
}

export interface LocalKmsOptions {
  masterKey: Buffer;
  store?: TenantKeyStore;
  /** Whether the master key is persistent configuration (false for the development fallback). */
  durable?: boolean;
}

export class LocalKms implements KmsProvider {
  readonly name = 'local';
  readonly durable: boolean;
  private readonly masterKey: Buffer;
  private readonly store: TenantKeyStore;
  /** Unsealed KEKs, cached per tenant/version for the process lifetime. */
  private readonly keks = new Map<string, Buffer>();
  private readonly pending = new Map<string, Promise<TenantKeyRecord>>();

  constructor(options: LocalKmsOptions) {
    if (options.masterKey.length !== KEY_BYTES) throw new KmsError('master key must be 32 bytes', 'MISCONFIGURED');
    this.masterKey = Buffer.from(options.masterKey);
    this.store = options.store ?? new InMemoryTenantKeyStore();
    this.durable = options.durable ?? true;
  }

  async generateDataKey(tenantId: string, context: EncryptionContext): Promise<DataKey> {
    assertTenant(tenantId);
    const record = await this.activeRecord(tenantId);
    const kek = this.unseal(record);
    const plaintext = randomBytes(KEY_BYTES);
    const { iv, tag, ciphertext } = gcmEncrypt(kek, plaintext, wrapAad(tenantId, record.version, context));
    return {
      plaintext,
      wrapped: {
        provider: this.name,
        tenantId,
        keyVersion: record.version,
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      },
    };
  }

  async decryptDataKey(wrapped: WrappedDataKey, context: EncryptionContext): Promise<Buffer> {
    assertTenant(wrapped.tenantId);
    if (wrapped.provider !== this.name) throw new KmsError(`Data key belongs to KMS provider ${wrapped.provider}`, 'KEY_NOT_FOUND');
    if (await this.store.isDestroyed(wrapped.tenantId)) {
      throw new KmsError('Tenant key has been destroyed', 'KEY_DESTROYED');
    }
    const record = (await this.store.list(wrapped.tenantId)).find((r) => r.version === wrapped.keyVersion);
    if (!record) throw new KmsError('Tenant key version not found', 'KEY_NOT_FOUND');

    const kek = this.unseal(record);
    try {
      return gcmDecrypt(
        kek,
        Buffer.from(wrapped.iv, 'base64'),
        Buffer.from(wrapped.tag, 'base64'),
        Buffer.from(wrapped.ciphertext, 'base64'),
        wrapAad(wrapped.tenantId, wrapped.keyVersion, context),
      );
    } catch {
      log.warn({ tenantId: wrapped.tenantId, keyVersion: wrapped.keyVersion }, 'Data key failed to unwrap');
      throw new KmsError('Data key could not be unwrapped for this tenant and context', 'UNWRAP_FAILED');
    }
  }

  async rewrapDataKey(wrapped: WrappedDataKey, context: EncryptionContext): Promise<WrappedDataKey> {
    const plaintext = await this.decryptDataKey(wrapped, context);
    try {
      const record = await this.activeRecord(wrapped.tenantId);
      if (record.version === wrapped.keyVersion) return wrapped;
      const { iv, tag, ciphertext } = gcmEncrypt(this.unseal(record), plaintext, wrapAad(wrapped.tenantId, record.version, context));
      return {
        provider: this.name,
        tenantId: wrapped.tenantId,
        keyVersion: record.version,
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      };
    } finally {
      plaintext.fill(0);
    }
  }

  async rotateTenantKey(tenantId: string): Promise<number> {
    assertTenant(tenantId);
    await this.assertNotDestroyed(tenantId);
    const records = await this.store.list(tenantId);
    for (const r of records.filter((r) => r.state === 'active')) {
      await this.store.put({ ...r, state: 'retired' });
    }
    const version = (records.at(-1)?.version ?? 0) + 1;
    await this.store.put(this.createRecord(tenantId, version));
    log.info({ tenantId, version }, 'Tenant key rotated');
    return version;
  }

  async destroyTenantKey(tenantId: string): Promise<void> {
    assertTenant(tenantId);
    await this.store.markDestroyed(tenantId);
    const removed = await this.store.deleteTenant(tenantId);
    for (const [cacheKey, kek] of this.keks) {
      if (cacheKey.startsWith(`${tenantId}\u0000`)) {
        kek.fill(0);
        this.keks.delete(cacheKey);
      }
    }
    log.warn({ tenantId, versions: removed }, 'Tenant key destroyed; its data can no longer be decrypted');
  }

  async activeKeyVersion(tenantId: string): Promise<number | undefined> {
    return (await this.store.list(tenantId)).find((r) => r.state === 'active')?.version;
  }

  private async assertNotDestroyed(tenantId: string): Promise<void> {
    if (await this.store.isDestroyed(tenantId)) {
      throw new KmsError('Tenant key has been destroyed', 'KEY_DESTROYED');
    }
  }

  /** The tenant's active KEK record, creating version 1 on first use (once, even under concurrency). */
  private async activeRecord(tenantId: string): Promise<TenantKeyRecord> {
    const active = (await this.store.list(tenantId)).find((r) => r.state === 'active');
    if (active) return active;
    await this.assertNotDestroyed(tenantId);

    let creating = this.pending.get(tenantId);
    if (!creating) {
      creating = (async () => {
        const record = this.createRecord(tenantId, 1);
        await this.store.put(record);
        log.info({ tenantId }, 'Tenant key created');
        return record;
      })().finally(() => this.pending.delete(tenantId));
      this.pending.set(tenantId, creating);
    }
    return creating;
  }

  private createRecord(tenantId: string, version: number): TenantKeyRecord {
    const kek = randomBytes(KEY_BYTES);
    const aad = Buffer.from(`agenticpay-kms/kek/v1|tenant=${encodeURIComponent(tenantId)}|version=${version}`, 'utf8');
    const { iv, tag, ciphertext } = gcmEncrypt(this.masterKey, kek, aad);
    this.keks.set(`${tenantId}\u0000${version}`, kek);
    return {
      tenantId,
      version,
      state: 'active',
      sealed: [iv, tag, ciphertext].map((b) => b.toString('base64')).join('.'),
      createdAt: new Date().toISOString(),
    };
  }

  private unseal(record: TenantKeyRecord): Buffer {
    const cacheKey = `${record.tenantId}\u0000${record.version}`;
    const cached = this.keks.get(cacheKey);
    if (cached) return cached;
    const [iv, tag, ciphertext] = record.sealed.split('.').map((part) => Buffer.from(part, 'base64'));
    const aad = Buffer.from(`agenticpay-kms/kek/v1|tenant=${encodeURIComponent(record.tenantId)}|version=${record.version}`, 'utf8');
    let kek: Buffer;
    try {
      kek = gcmDecrypt(this.masterKey, iv, tag, ciphertext, aad);
    } catch {
      throw new KmsError('Tenant key could not be unsealed; is KMS_MASTER_KEY correct?', 'MISCONFIGURED');
    }
    this.keks.set(cacheKey, kek);
    return kek;
  }
}

// ── Default provider ─────────────────────────────────────────────────────────

/**
 * `KMS_MASTER_KEY` is required in production. Elsewhere a random master key
 * is generated per process (with a warning), so nothing encrypted in
 * development is readable after a restart, and no fixed development key
 * exists that could leak into a real deployment.
 */
export function kmsFromEnv(env: NodeJS.ProcessEnv = process.env): KmsProvider {
  if (env.KMS_MASTER_KEY) return new LocalKms({ masterKey: parseMasterKey(env.KMS_MASTER_KEY) });
  if (env.NODE_ENV === 'production') {
    throw new KmsError('KMS_MASTER_KEY is required in production', 'MISCONFIGURED');
  }
  log.warn('KMS_MASTER_KEY is not set: using an ephemeral master key; encrypted data will not survive a restart');
  return new LocalKms({ masterKey: randomBytes(KEY_BYTES), durable: false });
}

let sharedKms: KmsProvider | undefined;

export function getKms(): KmsProvider {
  sharedKms ??= kmsFromEnv();
  return sharedKms;
}

/** Replace the shared provider (tests, or a cloud KMS adapter). Pass nothing to reset. */
export function setKms(provider?: KmsProvider): void {
  sharedKms = provider;
}
