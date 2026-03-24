import { describe, it, expect } from 'vitest';
import {
  validateStellarAddress,
  validateTransactionHash,
  ValidationError,
} from './stellar.js';

// A valid Stellar public key confirmed by StrKey.isValidEd25519PublicKey
const VALID_ADDRESS = 'GASM3DIOMS7Q6MGWNC373VL4CIEO3LB4TBDXQQO6EM5AWS5BRITEJDAZ';

// A valid 64-char lowercase hex tx hash (SHA-256 value)
const VALID_TX_HASH =
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

// ─── validateStellarAddress ─────────────────────────────────────────────────

describe('validateStellarAddress', () => {
  it('accepts a valid Stellar public key', () => {
    expect(() => validateStellarAddress(VALID_ADDRESS)).not.toThrow();
  });

  it('throws ValidationError for an empty string', () => {
    expect(() => validateStellarAddress('')).toThrow(ValidationError);
    expect(() => validateStellarAddress('')).toThrow(/must not be empty/i);
  });

  it('throws ValidationError for a whitespace-only string', () => {
    expect(() => validateStellarAddress('   ')).toThrow(ValidationError);
  });

  it('throws ValidationError for an address with a wrong prefix (S… secret key)', () => {
    // A real secret key starts with S — should be rejected as an account address
    const secretKey = 'SCZANGBA5AKIA57CAWXOGJDJVXOUXNWLLMBUOFAHJMEBHQY3PSDE6BZB';
    expect(() => validateStellarAddress(secretKey)).toThrow(ValidationError);
    expect(() => validateStellarAddress(secretKey)).toThrow(/invalid stellar address/i);
  });

  it('throws ValidationError for a string that starts with G but is too short', () => {
    expect(() => validateStellarAddress('GABC')).toThrow(ValidationError);
  });

  it('throws ValidationError for a string that starts with G but is too long', () => {
    expect(() => validateStellarAddress(VALID_ADDRESS + 'EXTRA')).toThrow(ValidationError);
  });

  it('throws ValidationError for a string with an invalid base32 character', () => {
    // Replace last char with '1' which is not in the Stellar/base32 alphabet
    const bad = VALID_ADDRESS.slice(0, -1) + '1';
    expect(() => validateStellarAddress(bad)).toThrow(ValidationError);
  });

  it('throws a ValidationError (statusCode 400) — not a generic Error', () => {
    const err = (() => {
      try {
        validateStellarAddress('bad');
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).statusCode).toBe(400);
  });
});

// ─── validateTransactionHash ────────────────────────────────────────────────

describe('validateTransactionHash', () => {
  it('accepts a valid 64-char lowercase hex hash', () => {
    expect(() => validateTransactionHash(VALID_TX_HASH)).not.toThrow();
  });

  it('accepts a valid 64-char uppercase hex hash (case-insensitive)', () => {
    expect(() => validateTransactionHash(VALID_TX_HASH.toUpperCase())).not.toThrow();
  });

  it('throws ValidationError for an empty string', () => {
    expect(() => validateTransactionHash('')).toThrow(ValidationError);
    expect(() => validateTransactionHash('')).toThrow(/must not be empty/i);
  });

  it('throws ValidationError for a whitespace-only string', () => {
    expect(() => validateTransactionHash('   ')).toThrow(ValidationError);
  });

  it('throws ValidationError when hash is shorter than 64 chars', () => {
    expect(() => validateTransactionHash(VALID_TX_HASH.slice(0, 32))).toThrow(ValidationError);
  });

  it('throws ValidationError when hash is longer than 64 chars', () => {
    expect(() => validateTransactionHash(VALID_TX_HASH + 'ab')).toThrow(ValidationError);
  });

  it('throws ValidationError for non-hex characters', () => {
    const bad = VALID_TX_HASH.slice(0, -2) + 'zz';
    expect(() => validateTransactionHash(bad)).toThrow(ValidationError);
    expect(() => validateTransactionHash(bad)).toThrow(/invalid transaction hash/i);
  });

  it('throws a ValidationError (statusCode 400)', () => {
    const err = (() => {
      try {
        validateTransactionHash('not-a-hash');
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).statusCode).toBe(400);
  });
});
