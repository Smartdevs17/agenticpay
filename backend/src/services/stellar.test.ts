import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  getAccountInfo,
  getTransactionStatus,
  InvalidStellarInputError,
  isValidStellarAddress,
  isValidTransactionHash,
} from './stellar.js';

const validStellarAddress = Keypair.random().publicKey();

describe('stellar validation', () => {
  describe('isValidStellarAddress', () => {
    it('accepts a valid Stellar public address', () => {
      expect(isValidStellarAddress(validStellarAddress)).toBe(true);
    });

    it('rejects empty or whitespace values', () => {
      expect(isValidStellarAddress('')).toBe(false);
      expect(isValidStellarAddress('   ')).toBe(false);
    });

    it('rejects wrong prefix and malformed values', () => {
      expect(
        isValidStellarAddress(
          'SCFX5VEQOTYNPI2D7Y4N4EJXXWQTH2QX4PQD3NQCV3K4M5JJFGBX7D7O'
        )
      ).toBe(false);
      expect(isValidStellarAddress('G123')).toBe(false);
      expect(isValidStellarAddress('not-a-stellar-address')).toBe(false);
    });
  });

  describe('isValidTransactionHash', () => {
    it('accepts a 64-char hex transaction hash', () => {
      expect(
        isValidTransactionHash(
          'a3f9e2c1d4b6a8f0e1d3c5b7a9f2e4d6c8b0a1e3d5f7b9c1a2d4e6f8b0c2d4e6'
        )
      ).toBe(true);
      expect(
        isValidTransactionHash(
          'A3F9E2C1D4B6A8F0E1D3C5B7A9F2E4D6C8B0A1E3D5F7B9C1A2D4E6F8B0C2D4E6'
        )
      ).toBe(true);
    });

    it('rejects empty, wrong length, and non-hex values', () => {
      expect(isValidTransactionHash('')).toBe(false);
      expect(isValidTransactionHash('   ')).toBe(false);
      expect(
        isValidTransactionHash(
          'a3f9e2c1d4b6a8f0e1d3c5b7a9f2e4d6c8b0a1e3d5f7b9c1a2d4e6f8b0c2d4'
        )
      ).toBe(false);
      expect(
        isValidTransactionHash(
          'z3f9e2c1d4b6a8f0e1d3c5b7a9f2e4d6c8b0a1e3d5f7b9c1a2d4e6f8b0c2d4e6'
        )
      ).toBe(false);
    });
  });

  describe('service-layer validation', () => {
    it('rejects invalid Stellar addresses before loading an account', async () => {
      await expect(getAccountInfo('G123')).rejects.toMatchObject({
        name: 'InvalidStellarInputError',
        message: 'Invalid Stellar address',
      } satisfies Partial<InvalidStellarInputError>);
    });

    it('rejects invalid transaction hashes before fetching a transaction', async () => {
      await expect(getTransactionStatus('not-a-hash')).rejects.toMatchObject({
        name: 'InvalidStellarInputError',
        message: 'Invalid transaction hash',
      } satisfies Partial<InvalidStellarInputError>);
    });
  });
});
