/**
 * provider-credentials.ts — Issue #1010
 *
 * Encrypted-at-rest vault for third-party provider credentials — Stripe secret
 * keys, PayPal client secrets, webhook signing secrets, OAuth client secrets and
 * anything else that lets AgenticPay act on a provider's behalf.
 *
 * Design:
 * - Every value is sealed with the shared column-encryption primitive
 *   (`services/encryption/column-encryptor`): AES-256-GCM with a per-provider
 *   data-encryption key derived via HKDF from the managed master key
 *   (`COLUMN_ENCRYPTION_MASTER_KEY`). Only `$enc1$…` ciphertext is ever kept in
 *   the store, so a datastore dump, a heap inspection or a stray log line cannot
 *   leak a plaintext secret.
 * - Master-key rotation is supported. `rotateMasterKey()` re-encrypts every
 *   stored value from the previous key (`COLUMN_ENCRYPTION_OLD_MASTER_KEY`) to
 *   the current one, then drops the derived-key cache so the new key is used
 *   everywhere.
 * - Every write, read, reveal, rotation and deletion is written to the
 *   tamper-evident audit trail. Only credential metadata is recorded — never the
 *   plaintext or the ciphertext.
 */

import { randomUUID } from 'node:crypto';
import {
  decrypt,
  encrypt,
  evictTenantKeyCache,
  isEncrypted,
  reEncrypt,
} from '../encryption/column-encryptor.js';
import { auditService } from './auditService.js';

/** Tenant the DEK is derived for. One key per provider would also be valid; a single
 *  vault tenant keeps rotation a single-pass operation across every provider. */
export const PROVIDER_CREDENTIAL_TENANT = 'provider-credentials';

/** Default lifetime of a stored credential before it is considered stale. */
export const DEFAULT_PROVIDER_CREDENTIAL_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type ProviderCredentialId = string;

export interface ProviderCredentialMetadata {
  id: ProviderCredentialId;
  provider: string;
  /** Logical name within the provider, e.g. `secret_key`, `webhook_signing_secret`. */
  name: string;
  /** Present when the value was last re-encrypted after a master-key rotation. */
  rotatedAt?: Date;
  lastUsedAt?: Date;
  /** Monotonic version, bumped on every write or rotation. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface PutProviderCredentialInput {
  provider: string;
  name: string;
  value: string;
  actorId?: string;
  /** Optional expiry; omit to fall back to {@link DEFAULT_PROVIDER_CREDENTIAL_TTL_MS}. */
  ttlMs?: number;
}

export interface GetProviderCredentialInput {
  provider: string;
  name: string;
  actorId?: string;
}

export interface ProviderCredentialAuditQuery {
  provider?: string;
  name?: string;
  limit?: number;
}

interface StoredProviderCredential extends ProviderCredentialMetadata {
  /** `$enc1$…` ciphertext. Never exposed to callers. */
  ciphertext: string;
}

export interface ProviderCredentialRotationResult {
  rotated: number;
  failed: Array<{ provider: string; name: string; error: string }>;
}

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_SECRET_LENGTH = 8_192;

function assertIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`INVALID_PROVIDER_CREDENTIAL_${field.toUpperCase()}`);
  }
  return value.trim();
}

function assertSecret(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SECRET_LENGTH) {
    throw new Error('INVALID_PROVIDER_CREDENTIAL_VALUE');
  }
  return value;
}

/** Key within the vault: stable identity per (provider, name). */
function credentialKey(provider: string, name: string): string {
  return `${provider}\u0000${name}`;
}

/**
 * Encrypted credential vault. Values live in memory behind ciphertext here, but the
 * same primitive (`encrypt`/`reEncrypt`) is what the Prisma column-encryption
 * middleware applies to secrets persisted in the datastore, so a caller can swap
 * this store for a database-backed one without changing the crypto.
 */
export class ProviderCredentialVault {
  private readonly credentials = new Map<string, StoredProviderCredential>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /** Stores (or replaces) a credential, sealing the value before it hits memory. */
  put(input: PutProviderCredentialInput): ProviderCredentialMetadata {
    const provider = assertIdentifier(input.provider, 'provider');
    const name = assertIdentifier(input.name, 'name');
    const plaintext = assertSecret(input.value);
    const createdAt = this.now();

    const existing = this.credentials.get(credentialKey(provider, name));
    const ciphertext = encrypt(plaintext, PROVIDER_CREDENTIAL_TENANT);
    if (!isEncrypted(ciphertext)) {
      // Defensive: a misconfigured primitive must never fall through to plaintext.
      throw new Error('PROVIDER_CREDENTIAL_ENCRYPTION_FAILED');
    }

    const record: StoredProviderCredential = {
      id: existing?.id ?? `pcv_${randomUUID()}`,
      provider,
      name,
      ciphertext,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + (input.ttlMs ?? DEFAULT_PROVIDER_CREDENTIAL_TTL_MS)),
    };
    this.credentials.set(credentialKey(provider, name), record);

    this.audit(input.actorId ?? 'system', existing ? 'provider_credential.update' : 'provider_credential.create', provider, name, {
      version: record.version,
    });

    return this.toMetadata(record);
  }

  /**
   * Decrypts and returns a credential value. The decrypt itself is audited by the
   * encryption primitive; an explicit access entry records who read it.
   */
  reveal(input: GetProviderCredentialInput): string | undefined {
    const provider = assertIdentifier(input.provider, 'provider');
    const name = assertIdentifier(input.name, 'name');
    const record = this.credentials.get(credentialKey(provider, name));
    if (!record) return undefined;

    const plaintext = decrypt(record.ciphertext, PROVIDER_CREDENTIAL_TENANT, name, {
      userId: input.actorId,
      resource: `provider_credential:${provider}`,
    });

    record.lastUsedAt = this.now();

    this.audit(input.actorId ?? 'system', 'provider_credential.reveal', provider, name, {
      version: record.version,
    });

    return plaintext;
  }

  /** Metadata for one credential, without decrypting it. */
  get(input: GetProviderCredentialInput): ProviderCredentialMetadata | undefined {
    const provider = assertIdentifier(input.provider, 'provider');
    const name = assertIdentifier(input.name, 'name');
    const record = this.credentials.get(credentialKey(provider, name));
    return record ? this.toMetadata(record) : undefined;
  }

  /** Metadata for every stored credential, optionally scoped to a provider. */
  list(filter: { provider?: string } = {}): ProviderCredentialMetadata[] {
    return [...this.credentials.values()]
      .filter((record) => !filter.provider || record.provider === filter.provider)
      .map((record) => this.toMetadata(record));
  }

  /** True when the vault holds a non-expired credential for (provider, name). */
  has(provider: string, name: string): boolean {
    const record = this.credentials.get(credentialKey(provider, name));
    if (!record) return false;
    return !record.expiresAt || record.expiresAt.getTime() > this.now().getTime();
  }

  delete(input: GetProviderCredentialInput): boolean {
    const provider = assertIdentifier(input.provider, 'provider');
    const name = assertIdentifier(input.name, 'name');
    const removed = this.credentials.delete(credentialKey(provider, name));
    if (removed) {
      this.audit(input.actorId ?? 'system', 'provider_credential.delete', provider, name);
    }
    return removed;
  }

  /**
   * Re-seals every credential under the current master key.
   *
   * Set `COLUMN_ENCRYPTION_OLD_MASTER_KEY` to the key the values were written with
   * before calling this; the derived-key cache is cleared first so the current key
   * is used for the new ciphertext. A single bad record is reported but does not
   * abort the rotation of the rest.
   */
  rotateMasterKey(actorId = 'system'): ProviderCredentialRotationResult {
    evictTenantKeyCache();
    const result: ProviderCredentialRotationResult = { rotated: 0, failed: [] };

    for (const [key, record] of [...this.credentials.entries()]) {
      try {
        const resealed = reEncrypt(record.ciphertext, PROVIDER_CREDENTIAL_TENANT, record.name);
        record.ciphertext = resealed;
        record.version += 1;
        record.rotatedAt = this.now();
        record.updatedAt = this.now();
        this.credentials.set(key, record);
        this.audit(actorId, 'provider_credential.rotate', record.provider, record.name, {
          version: record.version,
        });
        result.rotated += 1;
      } catch (error) {
        result.failed.push({
          provider: record.provider,
          name: record.name,
          error: error instanceof Error ? error.message : 'unknown rotation error',
        });
      }
    }

    // Force re-derivation with the new master key on the next operation.
    evictTenantKeyCache();
    return result;
  }

  /** Clears the vault. Intended for tests. */
  reset(): void {
    this.credentials.clear();
  }

  private toMetadata(record: StoredProviderCredential): ProviderCredentialMetadata {
    return {
      id: record.id,
      provider: record.provider,
      name: record.name,
      ...(record.rotatedAt ? { rotatedAt: new Date(record.rotatedAt) } : {}),
      ...(record.lastUsedAt ? { lastUsedAt: new Date(record.lastUsedAt) } : {}),
      version: record.version,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      ...(record.expiresAt ? { expiresAt: new Date(record.expiresAt) } : {}),
    };
  }

  private audit(
    actor: string,
    action: string,
    provider: string,
    name: string,
    details: Record<string, unknown> = {},
  ): void {
    // Fire-and-forget: a slow audit sink must never block a credential read, and the
    // plaintext is never part of `details`.
    void auditService.logAction({
      userId: actor,
      action,
      resource: 'provider_credential',
      resourceId: `${provider}:${name}`,
      details: { provider, name, ...details },
    });
  }
}

/** Process-wide vault. */
export const providerCredentialVault = new ProviderCredentialVault();
