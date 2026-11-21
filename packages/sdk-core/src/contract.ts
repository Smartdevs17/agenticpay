/**
 * packages/sdk-core/src/contract.ts
 *
 * Soroban contract hashing and manifest verification helpers.
 */

import { createHash } from 'node:crypto';
import { isValidContractId } from './address.js';
import type { ContractBuildManifest } from './types.js';

export const WASM_SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export class ContractVerificationError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'ContractVerificationError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** SHA-256 of raw WASM bytecode, hex encoded (matching Soroban spec). */
export function computeContractWasmHash(wasm: Uint8Array): string {
  return createHash('sha256').update(wasm).digest('hex');
}

export function parseContractBuildManifest(raw: string): ContractBuildManifest {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ContractVerificationError('Contract build manifest is not valid JSON', 'MANIFEST_INVALID');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ContractVerificationError('Contract build manifest must be a JSON object', 'MANIFEST_INVALID');
  }

  const record = parsed as Record<string, unknown>;
  const contractId = typeof record.contractId === 'string' ? record.contractId.trim() : '';
  const network = record.network;
  const wasmSha256 = typeof record.wasmSha256 === 'string' ? record.wasmSha256.trim().toLowerCase() : '';

  if (!contractId) {
    throw new ContractVerificationError('Contract build manifest is missing contractId', 'MANIFEST_INVALID');
  }
  if (!isValidContractId(contractId)) {
    throw new ContractVerificationError('Contract build manifest contains an invalid contractId', 'MANIFEST_INVALID_CONTRACT_ID');
  }
  if (network !== 'testnet' && network !== 'public') {
    throw new ContractVerificationError('Contract build manifest network must be "testnet" or "public"', 'MANIFEST_INVALID_NETWORK');
  }
  if (!WASM_SHA256_PATTERN.test(wasmSha256)) {
    throw new ContractVerificationError('Contract build manifest wasmSha256 must be a 64-character hex SHA-256 hash', 'MANIFEST_INVALID_HASH');
  }

  return {
    contractId,
    network,
    wasmSha256,
    wasmFile: typeof record.wasmFile === 'string' ? record.wasmFile : undefined,
    builtAt: typeof record.builtAt === 'string' ? record.builtAt : undefined,
  };
}
