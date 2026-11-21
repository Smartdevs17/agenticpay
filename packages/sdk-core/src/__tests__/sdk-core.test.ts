import { describe, it, expect } from 'vitest';
import * as StellarSdk from '@stellar/stellar-sdk';
import {
  isValidStellarAddress,
  isValidContractId,
  isValidTransactionHash,
  parseAsset,
  parseAmount,
  formatAmount,
  InvalidStellarInputError,
} from '../address.js';
import {
  getHorizonUrl,
  getSorobanRpcUrl,
  getNetworkPassphrase,
  createHorizonServer,
} from '../network.js';
import {
  estimateFee,
  computeReplacementFee,
  isTransactionStuck,
  translateStellarError,
} from '../transaction.js';
import {
  computeContractWasmHash,
  parseContractBuildManifest,
  ContractVerificationError,
} from '../contract.js';

describe('Issue #1398: @agenticpay/sdk-core Unit Tests', () => {
  // Generate random test keypair
  const validKeypair = StellarSdk.Keypair.random();
  const validAddress = validKeypair.publicKey();
  const validContractId = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';
  const validTxHash = 'a'.repeat(64);

  describe('address and identifier validation', () => {
    it('validates a correct Stellar Ed25519 public key', () => {
      expect(isValidStellarAddress(validAddress)).toBe(true);
    });

    it('rejects invalid or malformed Stellar addresses', () => {
      expect(isValidStellarAddress('invalid-address')).toBe(false);
      expect(isValidStellarAddress('')).toBe(false);
      expect(isValidStellarAddress('G12345')).toBe(false);
    });

    it('validates a correct Soroban contract ID', () => {
      expect(isValidContractId(validContractId)).toBe(true);
    });

    it('rejects an invalid contract ID', () => {
      expect(isValidContractId('not-a-contract-id')).toBe(false);
      expect(isValidContractId('')).toBe(false);
    });

    it('validates 64-character hexadecimal transaction hashes', () => {
      expect(isValidTransactionHash(validTxHash)).toBe(true);
      expect(isValidTransactionHash('12345')).toBe(false);
      expect(isValidTransactionHash('g'.repeat(64))).toBe(false);
    });
  });

  describe('asset and amount parsing', () => {
    it('parses native XLM asset', () => {
      const native1 = parseAsset('XLM');
      const native2 = parseAsset('native');
      const native3 = parseAsset(undefined);

      expect(native1.isNative()).toBe(true);
      expect(native2.isNative()).toBe(true);
      expect(native3.isNative()).toBe(true);
    });

    it('parses issued credit asset with valid issuer', () => {
      const usdc = parseAsset('USDC', validAddress);
      expect(usdc.getCode()).toBe('USDC');
      expect(usdc.getIssuer()).toBe(validAddress);
    });

    it('throws InvalidStellarInputError when issuer is missing for credit asset', () => {
      expect(() => parseAsset('USDC')).toThrow(InvalidStellarInputError);
    });

    it('parses amount within 7 decimal precision', () => {
      expect(parseAmount('10.50')).toBe('10.5');
      expect(parseAmount(25)).toBe('25');
    });

    it('rejects non-positive or non-numeric amount', () => {
      expect(() => parseAmount('-5')).toThrow(InvalidStellarInputError);
      expect(() => parseAmount('abc')).toThrow(InvalidStellarInputError);
    });

    it('formats amount to specified decimal places', () => {
      expect(formatAmount(1234.5, 2)).toBe('1,234.50');
      expect(formatAmount('99.9', 2)).toBe('99.90');
    });
  });

  describe('network and client helpers', () => {
    it('returns correct Horizon URLs for networks', () => {
      expect(getHorizonUrl('public')).toBe('https://horizon.stellar.org');
      expect(getHorizonUrl('testnet')).toBe('https://horizon-testnet.stellar.org');
    });

    it('returns correct network passphrases', () => {
      expect(getNetworkPassphrase('public')).toBe(StellarSdk.Networks.PUBLIC);
      expect(getNetworkPassphrase('testnet')).toBe(StellarSdk.Networks.TESTNET);
    });

    it('instantiates Horizon server without throwing or connecting immediately', () => {
      const server = createHorizonServer('testnet');
      expect(server).toBeDefined();
    });
  });

  describe('transaction & fee helpers', () => {
    it('estimates fees based on operation count', () => {
      expect(estimateFee(100, 1)).toBe(100);
      expect(estimateFee(100, 3)).toBe(300);
    });

    it('computes fee bump replacement fee', () => {
      expect(computeReplacementFee(100, 1.2)).toBe(120);
      expect(computeReplacementFee(250, 1.5)).toBe(375);
    });

    it('detects stuck transactions based on timeout', () => {
      const now = Date.now();
      expect(isTransactionStuck(now - 70_000, 60_000)).toBe(true);
      expect(isTransactionStuck(now - 10_000, 60_000)).toBe(false);
    });

    it('translates Horizon error payload into canonical error structure', () => {
      const mockHorizonErr = {
        response: {
          status: 400,
          data: {
            title: 'Transaction Failed',
            detail: 'insufficient balance',
            extras: {
              result_codes: { transaction: 'tx_insufficient_balance' },
            },
          },
        },
      };

      const translated = translateStellarError(mockHorizonErr);
      expect(translated.code).toBe('ERR_PAYMENT_INSUFFICIENT_FUNDS');
      expect(translated.status).toBe(400);
      expect(translated.message).toContain('insufficient balance');
    });
  });

  describe('contract hash & manifest verification', () => {
    it('computes 64-character SHA-256 hex hash from raw bytes', () => {
      const fakeWasm = new Uint8Array([1, 2, 3, 4, 5]);
      const hash = computeContractWasmHash(fakeWasm);
      expect(hash).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });

    it('parses valid contract build manifest', () => {
      const manifestJson = JSON.stringify({
        contractId: validContractId,
        network: 'testnet',
        wasmSha256: 'a'.repeat(64),
      });

      const manifest = parseContractBuildManifest(manifestJson);
      expect(manifest.contractId).toBe(validContractId);
      expect(manifest.network).toBe('testnet');
      expect(manifest.wasmSha256).toBe('a'.repeat(64));
    });

    it('rejects invalid manifest JSON', () => {
      expect(() => parseContractBuildManifest('invalid json')).toThrow(ContractVerificationError);
    });
  });
});
