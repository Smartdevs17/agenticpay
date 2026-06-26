// Column-level AES-256-GCM encryption — Issue #511
//
// Design:
// - Envelope encryption: per-tenant DEK derived via HKDF from a master key
// - Probabilistic (random IV): for storage fields where uniqueness isn't required
// - Deterministic (HMAC-derived IV): for searchable fields (email exact-match)
// - Audit log: every decryption is logged (field-level, not value-level)
// - Performance target: <5ms per operation (in-process, no network round-trip)
//
// Master key source: COLUMN_ENCRYPTION_MASTER_KEY env var (hex-encoded 32 bytes)
// Falls back to a development-only default with a warning.

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { auditService } from '../services/auditService.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const ENC_PREFIX = '$enc1$'; // version prefix for forward-compatibility
const DET_PREFIX = '$det1$'; // deterministic variant prefix

// ---------------------------------------------------------------------------
// Master key
// ---------------------------------------------------------------------------

function getMasterKey(): Buffer {
  const raw = process.env.COLUMN_ENCRYPTION_MASTER_KEY;
  if (raw && raw.length === 64) {
    return Buffer.from(raw, 'hex');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[encryption] COLUMN_ENCRYPTION_MASTER_KEY is required in production');
  }
  // Dev-only insecure default
  console.warn('[encryption] WARNING: using insecure dev master key — set COLUMN_ENCRYPTION_MASTER_KEY');
  return Buffer.alloc(KEY_LEN, 0x42);
}

// Tenant DEK cache (avoid re-deriving on every call)
const dekCache = new Map<string, Buffer>();

function deriveTenantKey(tenantId: string): Buffer {
  const cached = dekCache.get(tenantId);
  if (cached) return cached;

  const master = getMasterKey();
  const dek = Buffer.from(
    hkdfSync('sha256', master, Buffer.from(tenantId, 'utf8'), 'column-enc-v1', KEY_LEN),
  );
  dekCache.set(tenantId, dek);
  return dek;
}

/** Rotate master key: clear the DEK cache so keys are re-derived on next use. */
export function evictTenantKeyCache(tenantId?: string): void {
  if (tenantId) {
    dekCache.delete(tenantId);
  } else {
    dekCache.clear();
  }
}

// ---------------------------------------------------------------------------
// Encryption / decryption
// ---------------------------------------------------------------------------

/** Encrypt a plaintext value with a random IV (non-searchable). */
export function encrypt(plaintext: string, tenantId: string): string {
  const key = deriveTenantKey(tenantId);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: $enc1$<iv_b64>$<cipher_b64>$<tag_b64>
  return `${ENC_PREFIX}${iv.toString('base64')}$${ciphertext.toString('base64')}$${tag.toString('base64')}`;
}

/**
 * Deterministic encryption for searchable fields (same plaintext → same output).
 * IV is derived from HMAC(tenantKey, "det:" + fieldName + ":" + plaintext).
 * ⚠ Trades semantic security for searchability; use only for equality lookups.
 */
export function encryptDeterministic(plaintext: string, tenantId: string, fieldName: string): string {
  const key = deriveTenantKey(tenantId);
  // Derive a stable 12-byte IV from key + field + value
  const ivFull = createHmac('sha256', key)
    .update(`det:${fieldName}:${plaintext}`)
    .digest();
  const iv = ivFull.subarray(0, IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${DET_PREFIX}${iv.toString('base64')}$${ciphertext.toString('base64')}$${tag.toString('base64')}`;
}

/** Decrypt a value produced by encrypt() or encryptDeterministic(). */
export function decrypt(
  value: string,
  tenantId: string,
  fieldName?: string,
  context?: { userId?: string; resource?: string },
): string {
  if (!isEncrypted(value)) return value;

  const prefix = value.startsWith(ENC_PREFIX) ? ENC_PREFIX : DET_PREFIX;
  const parts = value.slice(prefix.length).split('$');
  if (parts.length !== 3) throw new Error('[encryption] Malformed encrypted value');

  const [ivB64, cipherB64, tagB64] = parts;
  const key = deriveTenantKey(tenantId);
  const iv = Buffer.from(ivB64, 'base64');
  const ciphertext = Buffer.from(cipherB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

  // Audit every decryption
  void auditService.logAction({
    userId: context?.userId,
    action: 'column_encryption.decrypt',
    resource: context?.resource ?? 'encrypted_field',
    details: { field: fieldName, tenantId },
  });

  return plaintext;
}

/** True when a string was produced by this module. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX) || value.startsWith(DET_PREFIX);
}

/**
 * Re-encrypt a value under a new master key (call after master key rotation).
 * The old master key must still be available in COLUMN_ENCRYPTION_OLD_MASTER_KEY
 * during the transition window.
 */
export function reEncrypt(encryptedValue: string, tenantId: string, fieldName?: string): string {
  const oldKey = process.env.COLUMN_ENCRYPTION_OLD_MASTER_KEY;
  if (!oldKey) throw new Error('[encryption] COLUMN_ENCRYPTION_OLD_MASTER_KEY required for re-encryption');

  // Temporarily override DEK to use old key for decryption
  const newKey = deriveTenantKey(tenantId);
  const oldMaster = Buffer.from(oldKey, 'hex');
  const oldDek = Buffer.from(hkdfSync('sha256', oldMaster, Buffer.from(tenantId, 'utf8'), 'column-enc-v1', KEY_LEN));

  const prefix = encryptedValue.startsWith(ENC_PREFIX) ? ENC_PREFIX : DET_PREFIX;
  const parts = encryptedValue.slice(prefix.length).split('$');
  const [ivB64, cipherB64, tagB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const ciphertext = Buffer.from(cipherB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');

  const decipher = createDecipheriv(ALGO, oldDek, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

  // Re-encrypt with current key
  const isDeterministic = encryptedValue.startsWith(DET_PREFIX);
  if (isDeterministic && fieldName) {
    return encryptDeterministic(plaintext, tenantId, fieldName);
  }

  const newIv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, newKey, newIv);
  const newCipher = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const newTag = cipher.getAuthTag();
  return `${ENC_PREFIX}${newIv.toString('base64')}$${newCipher.toString('base64')}$${newTag.toString('base64')}`;
}
