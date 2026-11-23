import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { InMemoryTenantKeyStore, KmsError, LocalKms, kmsFromEnv, parseMasterKey } from '../kms.js';

const ctx = { purpose: 'kyc-document', document: 'doc-1' };

function kms(store = new InMemoryTenantKeyStore(), masterKey = randomBytes(32)) {
  return { kms: new LocalKms({ masterKey, store }), store, masterKey };
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof KmsError ? error.code : `unexpected: ${String(error)}`;
  }
  return undefined;
}

describe('LocalKms (#1470)', () => {
  it('issues a fresh data key per call and unwraps it with the same tenant and context', async () => {
    const { kms: k } = kms();
    const a = await k.generateDataKey('tenant-a', ctx);
    const b = await k.generateDataKey('tenant-a', ctx);

    expect(a.plaintext).toHaveLength(32);
    expect(a.plaintext.equals(b.plaintext)).toBe(false);
    expect((await k.decryptDataKey(a.wrapped, ctx)).equals(a.plaintext)).toBe(true);
    expect(a.wrapped).toMatchObject({ provider: 'local', tenantId: 'tenant-a', keyVersion: 1 });
    expect(JSON.stringify(a.wrapped)).not.toContain(a.plaintext.toString('base64'));
  });

  it('gives every tenant its own key: a wrapped key moved to another tenant does not unwrap', async () => {
    const { kms: k } = kms();
    const a = await k.generateDataKey('tenant-a', ctx);
    await k.generateDataKey('tenant-b', ctx);
    expect(await code(k.decryptDataKey({ ...a.wrapped, tenantId: 'tenant-b' }, ctx))).toBe('UNWRAP_FAILED');
  });

  it('binds the encryption context', async () => {
    const { kms: k } = kms();
    const a = await k.generateDataKey('tenant-a', ctx);
    expect(await code(k.decryptDataKey(a.wrapped, { ...ctx, document: 'doc-2' }))).toBe('UNWRAP_FAILED');
  });

  it('only stores tenant keys sealed by the master key', async () => {
    const { kms: k, store } = kms();
    const a = await k.generateDataKey('tenant-a', ctx);
    const [record] = await store.list('tenant-a');
    expect(record.sealed.split('.')).toHaveLength(3);

    // A process with the same store and master key can still decrypt; another master key cannot.
    const same = new LocalKms({ masterKey: (k as unknown as { masterKey: Buffer }).masterKey, store });
    expect((await same.decryptDataKey(a.wrapped, ctx)).equals(a.plaintext)).toBe(true);
    const other = new LocalKms({ masterKey: randomBytes(32), store });
    expect(await code(other.decryptDataKey(a.wrapped, ctx))).toBe('MISCONFIGURED');
  });

  it('rotates: new keys use the new version, old data keys still unwrap and can be rewrapped', async () => {
    const { kms: k } = kms();
    const before = await k.generateDataKey('tenant-a', ctx);
    expect(await k.rotateTenantKey('tenant-a')).toBe(2);
    expect(await k.activeKeyVersion('tenant-a')).toBe(2);

    const after = await k.generateDataKey('tenant-a', ctx);
    expect(after.wrapped.keyVersion).toBe(2);
    expect((await k.decryptDataKey(before.wrapped, ctx)).equals(before.plaintext)).toBe(true);

    const rewrapped = await k.rewrapDataKey(before.wrapped, ctx);
    expect(rewrapped.keyVersion).toBe(2);
    expect((await k.decryptDataKey(rewrapped, ctx)).equals(before.plaintext)).toBe(true);
    expect(await k.rewrapDataKey(rewrapped, ctx)).toBe(rewrapped);
  });

  it('crypto-shreds: after destroying a tenant key nothing of that tenant decrypts, and the key is not re-created', async () => {
    const { kms: k } = kms();
    const a = await k.generateDataKey('tenant-a', ctx);
    const b = await k.generateDataKey('tenant-b', ctx);
    await k.destroyTenantKey('tenant-a');

    expect(await code(k.decryptDataKey(a.wrapped, ctx))).toBe('KEY_DESTROYED');
    expect(await code(k.generateDataKey('tenant-a', ctx))).toBe('KEY_DESTROYED');
    expect(await code(k.rotateTenantKey('tenant-a'))).toBe('KEY_DESTROYED');
    expect((await k.decryptDataKey(b.wrapped, ctx)).equals(b.plaintext)).toBe(true);
  });

  it('creates a tenant key once under concurrent first use', async () => {
    const { kms: k, store } = kms();
    await Promise.all(Array.from({ length: 10 }, () => k.generateDataKey('tenant-a', ctx)));
    expect(await store.list('tenant-a')).toHaveLength(1);
  });

  it('rejects malformed tenant ids', async () => {
    const { kms: k } = kms();
    expect(await code(k.generateDataKey('../etc', ctx))).toBe('INVALID_TENANT');
  });
});

describe('KMS configuration', () => {
  it('parses a 32-byte master key as hex or base64 and rejects anything else', () => {
    const key = randomBytes(32);
    expect(parseMasterKey(key.toString('hex')).equals(key)).toBe(true);
    expect(parseMasterKey(key.toString('base64')).equals(key)).toBe(true);
    expect(() => parseMasterKey('too-short')).toThrow(KmsError);
  });

  it('requires KMS_MASTER_KEY in production', () => {
    expect(() => kmsFromEnv({ NODE_ENV: 'production' })).toThrow(/KMS_MASTER_KEY/);
  });

  it('uses a durable key when configured and an ephemeral one otherwise', () => {
    expect(kmsFromEnv({ KMS_MASTER_KEY: randomBytes(32).toString('hex') }).durable).toBe(true);
    expect(kmsFromEnv({ NODE_ENV: 'development' }).durable).toBe(false);
  });
});
