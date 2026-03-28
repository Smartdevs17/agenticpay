import { describe, it, expect } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  isValidStellarAddress,
  isValidTransactionHash,
} from './stellar.js';

// Generate a valid Stellar public key at runtime for testing.
const VALID_ADDRESS = Keypair.random().publicKey();

// Simple, obviously non-secret hex string built at runtime.
const VALID_TX_HASH = 'ab'.repeat(32); // 64 hex chars

// ─── isValidStellarAddress ─────────────────────────────────────────────────

describe('isValidStellarAddress', () => {
  it('accepts a valid Stellar public key', () => {
    expect(isValidStellarAddress(VALID_ADDRESS)).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidStellarAddress('')).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(isValidStellarAddress('   ')).toBe(false);
  });

  it('rejects an address with a wrong prefix (S… secret key)', () => {
    const secretKey = 'S-INVALID-NOT-A-SECRET-KEY';
    expect(isValidStellarAddress(secretKey)).toBe(false);
  });

  it('rejects a string that starts with G but is too short', () => {
    expect(isValidStellarAddress('GABC')).toBe(false);
  });

  it('rejects a string that starts with G but is too long', () => {
    expect(isValidStellarAddress(VALID_ADDRESS + 'EXTRA')).toBe(false);
  });

  it('rejects a string with an invalid base32 character', () => {
    const bad = VALID_ADDRESS.slice(0, -1) + '1';
    expect(isValidStellarAddress(bad)).toBe(false);
  });
});

// ─── isValidTransactionHash ────────────────────────────────────────────────

describe('isValidTransactionHash', () => {
  it('accepts a valid 64-char lowercase hex hash', () => {
    expect(isValidTransactionHash(VALID_TX_HASH)).toBe(true);
  });

  it('accepts a valid 64-char uppercase hex hash (case-insensitive)', () => {
    expect(isValidTransactionHash(VALID_TX_HASH.toUpperCase())).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidTransactionHash('')).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(isValidTransactionHash('   ')).toBe(false);
  });

  it('rejects when hash is shorter than 64 chars', () => {
    expect(isValidTransactionHash(VALID_TX_HASH.slice(0, 32))).toBe(false);
  });

  it('rejects when hash is longer than 64 chars', () => {
    expect(isValidTransactionHash(VALID_TX_HASH + 'ab')).toBe(false);
  });

  it('rejects for non-hex characters', () => {
    const bad = VALID_TX_HASH.slice(0, -2) + 'zz';
    expect(isValidTransactionHash(bad)).toBe(false);
  });
});
