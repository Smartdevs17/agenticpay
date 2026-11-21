/**
 * packages/sdk-core/src/types.ts
 *
 * Core types for Stellar network and account abstractions.
 */

export type StellarNetwork = 'testnet' | 'public';

export interface StellarAccountBalance {
  type: string;
  balance: string;
  assetCode?: string;
  assetIssuer?: string;
}

export interface StellarAccountInfo {
  address: string;
  balances: StellarAccountBalance[];
  sequence: string;
}

export interface StellarTransactionRecord {
  hash: string;
  successful: boolean;
  ledger: number;
  createdAt: string;
  memo?: string;
  operationCount: number;
}

export interface StellarErrorTranslation {
  code: string;
  message: string;
  status: number;
  details?: unknown;
}

export interface ContractBuildManifest {
  contractId: string;
  network: 'testnet' | 'public';
  wasmSha256: string;
  wasmFile?: string;
  builtAt?: string;
}
