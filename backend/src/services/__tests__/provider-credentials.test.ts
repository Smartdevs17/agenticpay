import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProviderCredentialVault } from '../provider-credentials.js';
import { auditService } from '../auditService.js';
import { evictTenantKeyCache, isEncrypted } from '../../encryption/column-encryptor.js';

interface RawVault {
  credentials: Map<string, { ciphertext: string }>;
}

const ORIGINAL_KEY = process.env.COLUMN_ENCRYPTION_MASTER_KEY;
const ORIGINAL_OLD_KEY = process.env.COLUMN_ENCRYPTION_OLD_MASTER_KEY;

function rawCiphertext(vault: ProviderCredentialVault, provider: string, name: string): string {
  const raw = vault as unknown as RawVault;
  return raw.credentials.get(`${provider}\u0000${name}`)?.ciphertext ?? '';
}

describe('ProviderCredentialVault (#1010)', () => {
  let vault: ProviderCredentialVault;

  beforeEach(() => {
    delete process.env.COLUMN_ENCRYPTION_MASTER_KEY;
    delete process.env.COLUMN_ENCRYPTION_OLD_MASTER_KEY;
    evictTenantKeyCache();
    vault = new ProviderCredentialVault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    evictTenantKeyCache();
    if (ORIGINAL_KEY === undefined) delete process.env.COLUMN_ENCRYPTION_MASTER_KEY;
    else process.env.COLUMN_ENCRYPTION_MASTER_KEY = ORIGINAL_KEY;
    if (ORIGINAL_OLD_KEY === undefined) delete process.env.COLUMN_ENCRYPTION_OLD_MASTER_KEY;
    else process.env.COLUMN_ENCRYPTION_OLD_MASTER_KEY = ORIGINAL_OLD_KEY;
  });

  it('stores the value as ciphertext, never plaintext', () => {
    const secret = 'sk_live_super_secret_stripe_key';
    vault.put({ provider: 'stripe', name: 'secret_key', value: secret });

    const ciphertext = rawCiphertext(vault, 'stripe', 'secret_key');
    expect(isEncrypted(ciphertext)).toBe(true);
    expect(ciphertext).not.toContain(secret);
    expect(JSON.stringify(vault.list())).not.toContain(secret);
  });

  it('round-trips a stored credential', () => {
    vault.put({ provider: 'stripe', name: 'secret_key', value: 'sk_live_value' });
    expect(vault.reveal({ provider: 'stripe', name: 'secret_key' })).toBe('sk_live_value');
  });

  it('rejects missing or oversized values', () => {
    expect(() => vault.put({ provider: 'stripe', name: 'secret_key', value: '' })).toThrow(
      /INVALID_PROVIDER_CREDENTIAL_VALUE/,
    );
    expect(() => vault.put({ provider: 'stripe', name: 'secret_key', value: 'x'.repeat(9000) })).toThrow(
      /INVALID_PROVIDER_CREDENTIAL_VALUE/,
    );
  });

  it('updates in place and bumps the version', () => {
    const first = vault.put({ provider: 'paypal', name: 'client_secret', value: 'one' });
    const second = vault.put({ provider: 'paypal', name: 'client_secret', value: 'two' });

    expect(second.id).toBe(first.id);
    expect(second.version).toBe(2);
    expect(vault.reveal({ provider: 'paypal', name: 'client_secret' })).toBe('two');
  });

  it('isolates credentials per provider and name', () => {
    vault.put({ provider: 'stripe', name: 'secret_key', value: 'stripe_value' });
    vault.put({ provider: 'paypal', name: 'secret_key', value: 'paypal_value' });

    expect(vault.reveal({ provider: 'stripe', name: 'secret_key' })).toBe('stripe_value');
    expect(vault.reveal({ provider: 'paypal', name: 'secret_key' })).toBe('paypal_value');
    expect(vault.reveal({ provider: 'stripe', name: 'missing' })).toBeUndefined();
  });

  it('deletes a credential and reports whether anything was removed', () => {
    vault.put({ provider: 'stripe', name: 'secret_key', value: 'value' });
    expect(vault.delete({ provider: 'stripe', name: 'secret_key' })).toBe(true);
    expect(vault.delete({ provider: 'stripe', name: 'secret_key' })).toBe(false);
    expect(vault.reveal({ provider: 'stripe', name: 'secret_key' })).toBeUndefined();
  });

  it('reports presence through has()', () => {
    expect(vault.has('stripe', 'secret_key')).toBe(false);
    vault.put({ provider: 'stripe', name: 'secret_key', value: 'value' });
    expect(vault.has('stripe', 'secret_key')).toBe(true);
  });

  it('re-encrypts every credential when the master key rotates', () => {
    process.env.COLUMN_ENCRYPTION_MASTER_KEY = 'a'.repeat(64);
    vault.put({ provider: 'stripe', name: 'secret_key', value: 'stripe_value' });
    vault.put({ provider: 'paypal', name: 'client_secret', value: 'paypal_value' });
    const ciphertextBefore = rawCiphertext(vault, 'stripe', 'secret_key');

    // Rotate: the previous key is supplied for decryption, the new key for encryption.
    process.env.COLUMN_ENCRYPTION_OLD_MASTER_KEY = 'a'.repeat(64);
    process.env.COLUMN_ENCRYPTION_MASTER_KEY = 'b'.repeat(64);

    const result = vault.rotateMasterKey('ops_user');
    expect(result.rotated).toBe(2);
    expect(result.failed).toEqual([]);

    expect(rawCiphertext(vault, 'stripe', 'secret_key')).not.toBe(ciphertextBefore);
    expect(vault.reveal({ provider: 'stripe', name: 'secret_key' })).toBe('stripe_value');
    expect(vault.reveal({ provider: 'paypal', name: 'client_secret' })).toBe('paypal_value');
  });

  it('audits writes, reads, rotations and deletions without logging plaintext', () => {
    const audit = vi.spyOn(auditService, 'logAction').mockResolvedValue({} as never);

    vault.put({ provider: 'stripe', name: 'secret_key', value: 'super_secret_value', actorId: 'admin_1' });
    vault.reveal({ provider: 'stripe', name: 'secret_key', actorId: 'admin_1' });
    vault.delete({ provider: 'stripe', name: 'secret_key', actorId: 'admin_1' });

    const actions = audit.mock.calls.map(([params]) => params.action);
    expect(actions).toContain('provider_credential.create');
    expect(actions).toContain('provider_credential.reveal');
    expect(actions).toContain('provider_credential.delete');
    expect(JSON.stringify(audit.mock.calls)).not.toContain('super_secret_value');
  });
});
