/**
 * packages/sdk-core/src/address.ts
 *
 * Address, contract ID, hash validation, and asset/amount formatting helpers.
 */

import * as StellarSdk from '@stellar/stellar-sdk';

export class InvalidStellarInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStellarInputError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isValidStellarAddress(address: string): boolean {
  if (!address || typeof address !== 'string' || !address.trim()) return false;
  return StellarSdk.StrKey.isValidEd25519PublicKey(address.trim());
}

export function isValidContractId(contractId: string): boolean {
  if (!contractId || typeof contractId !== 'string' || !contractId.trim()) return false;
  return StellarSdk.StrKey.isValidContract(contractId.trim());
}

export function isValidTransactionHash(hash: string): boolean {
  if (!hash || typeof hash !== 'string' || !hash.trim()) return false;
  return /^[A-Fa-f0-9]{64}$/.test(hash.trim());
}

export function assertValidStellarAddress(address: string): void {
  if (!isValidStellarAddress(address)) {
    throw new InvalidStellarInputError('Invalid Stellar address');
  }
}

export function assertValidTransactionHash(hash: string): void {
  if (!isValidTransactionHash(hash)) {
    throw new InvalidStellarInputError('Invalid transaction hash');
  }
}

export function assertValidContractId(contractId: string): void {
  if (!isValidContractId(contractId)) {
    throw new InvalidStellarInputError('Invalid contract ID');
  }
}

export function formatStellarAddress(address: string, chars = 4): string {
  if (!address || address.length < chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function parseAsset(assetCode?: string, issuer?: string): StellarSdk.Asset {
  if (!assetCode || assetCode.toUpperCase() === 'XLM' || assetCode.toUpperCase() === 'NATIVE') {
    return StellarSdk.Asset.native();
  }

  if (!issuer) {
    throw new InvalidStellarInputError(`Asset issuer is required for non-native asset ${assetCode}`);
  }

  assertValidStellarAddress(issuer);
  return new StellarSdk.Asset(assetCode, issuer);
}

export function parseAmount(amount: string | number): string {
  const num = typeof amount === 'number' ? amount : parseFloat(amount);
  if (isNaN(num) || num <= 0) {
    throw new InvalidStellarInputError(`Amount must be a positive number: ${amount}`);
  }
  // Stellar supports up to 7 decimal places (stroops)
  return Number(num.toFixed(7)).toString();
}

export function formatAmount(amount: string | number, decimals = 2): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '0.00';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
