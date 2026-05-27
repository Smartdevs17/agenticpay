import * as StellarSdk from '@stellar/stellar-sdk';
import { config } from '../config/env.js';
import { withQueryProfiling } from '../config/database.js';

const NETWORK = config().STELLAR_NETWORK;
const HORIZON_URL =
  NETWORK === 'public'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';

export const server = new StellarSdk.Horizon.Server(HORIZON_URL);

const networkPassphrase =
  NETWORK === 'public'
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

export class ValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = statusCode;
  }
}

export class InvalidStellarInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStellarInputError';
  }
}

export class UnitOfWorkError extends Error {
  operation: string;
  cause?: Error;

  constructor(message: string, operation: string, cause?: Error) {
    super(message);
    this.name = 'UnitOfWorkError';
    this.operation = operation;
    this.cause = cause;
  }
}

export interface OperationResult {
  operation: string;
  status: 'success' | 'failed';
  error?: string;
  txHash?: string;
}

export interface UnitOfWorkResult {
  success: boolean;
  results: OperationResult[];
  operations: number;
  completed: number;
  failed: number;
  rollbackPerformed: boolean;
}

interface NonceState {
  current: string;
  locked: boolean;
  lastUsedAt: number;
}

class NonceManager {
  private nonces = new Map<string, NonceState>();
  private maxRetries = 3;
  private retryDelayMs = 1000;

  async acquire(address: string): Promise<string> {
    const state = this.nonces.get(address) || { current: '0', locked: false, lastUsedAt: 0 };

    if (state.locked) {
      throw new UnitOfWorkError(
        `Nonce conflict for ${address}: already in use`,
        'acquire-nonce',
      );
    }

    try {
      const account = await server.loadAccount(address);
      state.current = account.sequence;
      state.locked = true;
      state.lastUsedAt = Date.now();
      this.nonces.set(address, state);
      return state.current;
    } catch (error) {
      throw new UnitOfWorkError(
        `Failed to acquire nonce for ${address}`,
        'acquire-nonce',
        error instanceof Error ? error : undefined,
      );
    }
  }

  release(address: string): void {
    const state = this.nonces.get(address);
    if (state) {
      state.locked = false;
      state.lastUsedAt = Date.now();
    }
  }

  increment(address: string): void {
    const state = this.nonces.get(address);
    if (state) {
      const seqNum = BigInt(state.current);
      state.current = (seqNum + 1n).toString();
    }
  }

  async resolveConflict(address: string): Promise<string> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const account = await server.loadAccount(address);
        const state = this.nonces.get(address);
        if (state) {
          state.current = account.sequence;
          state.locked = true;
        }
        return account.sequence;
      } catch {
        if (attempt < this.maxRetries) {
          await new Promise(r => setTimeout(r, this.retryDelayMs * attempt));
        }
      }
    }
    throw new UnitOfWorkError(
      `Failed to resolve nonce conflict for ${address} after ${this.maxRetries} retries`,
      'resolve-nonce-conflict',
    );
  }

  getState(address: string): NonceState | undefined {
    return this.nonces.get(address);
  }

  cleanup(olderThanMs = 300_000): void {
    const cutoff = Date.now() - olderThanMs;
    for (const [address, state] of this.nonces.entries()) {
      if (!state.locked && state.lastUsedAt < cutoff) {
        this.nonces.delete(address);
      }
    }
  }
}

class GasEstimator {
  private baseFee = 100;
  private surgeMultiplier = 1.0;
  private maxMultiplier = 5.0;
  private lastEstimate = 100;
  private estimateTimestamp = 0;
  private estimateTtlMs = 30_000;

  async estimateFee(operations: number): Promise<{
    recommended: number;
    min: number;
    max: number;
    surge: boolean;
  }> {
    const now = Date.now();
    if (now - this.estimateTimestamp > this.estimateTtlMs) {
      try {
        const feeStats = await server.feeStats();
        this.baseFee = parseInt(feeStats.max_fee?.mode || '100', 10);
        this.lastEstimate = this.baseFee;
        this.estimateTimestamp = now;

        const ledgers = parseInt(feeStats.last_ledger, 10) || 0;
        const surge = feeStats.max_fee?.mode && parseInt(feeStats.max_fee.mode, 10) > 1000;
        this.surgeMultiplier = surge ? 2.0 : 1.0;
      } catch {
        this.baseFee = Math.max(this.baseFee, 100);
      }
    }

    const baseOps = this.baseFee * operations;
    const recommended = Math.ceil(baseOps * this.surgeMultiplier);
    const min = this.baseFee * operations;
    const max = Math.ceil(this.baseFee * this.maxMultiplier * operations);

    return {
      recommended,
      min,
      max,
      surge: this.surgeMultiplier > 1.0,
    };
  }

  priceBump(currentFee: number): number {
    return Math.ceil(currentFee * 1.2);
  }
}

export class UnitOfWork {
  private operations: Array<{
    type: string;
    fn: () => Promise<string>;
    compensation?: () => Promise<void>;
    executed: boolean;
    result?: string;
  }> = [];

  private completed: OperationResult[] = [];
  private rollbackPerformed = false;
  private nonceManager: NonceManager;
  private gasEstimator: GasEstimator;
  private sourceAddress?: string;
  private acquiredNonce = false;

  constructor() {
    this.nonceManager = getNonceManager();
    this.gasEstimator = getGasEstimator();
  }

  setSourceAddress(address: string): this {
    this.sourceAddress = address;
    return this;
  }

  addOperation<T>(
    type: string,
    fn: () => Promise<string>,
    compensation?: () => Promise<void>,
  ): this {
    this.operations.push({ type, fn, compensation, executed: false });
    return this;
  }

  async commit(): Promise<UnitOfWorkResult> {
    const results: OperationResult[] = [];

    if (this.sourceAddress && !this.acquiredNonce) {
      try {
        await this.nonceManager.acquire(this.sourceAddress);
        this.acquiredNonce = true;
      } catch (error) {
        return {
          success: false,
          results: [{
            operation: 'acquire-nonce',
            status: 'failed',
            error: error instanceof Error ? error.message : 'Failed to acquire nonce',
          }],
          operations: this.operations.length + 1,
          completed: 0,
          failed: 1,
          rollbackPerformed: false,
        };
      }
    }

    for (const op of this.operations) {
      try {
        const txHash = await op.fn();
        op.executed = true;
        op.result = txHash;

        const result: OperationResult = {
          operation: op.type,
          status: 'success',
          txHash,
        };
        results.push(result);
        this.completed.push(result);

        if (this.sourceAddress) {
          this.nonceManager.increment(this.sourceAddress);
        }
      } catch (error) {
        const result: OperationResult = {
          operation: op.type,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        results.push(result);
        this.completed.push(result);

        await this.rollback();
        this.rollbackPerformed = true;

        if (this.sourceAddress) {
          this.nonceManager.release(this.sourceAddress);
          this.acquiredNonce = false;
        }

        return {
          success: false,
          results,
          operations: this.operations.length,
          completed: this.completed.filter(r => r.status === 'success').length,
          failed: this.completed.filter(r => r.status === 'failed').length,
          rollbackPerformed: true,
        };
      }
    }

    if (this.sourceAddress) {
      this.nonceManager.release(this.sourceAddress);
      this.acquiredNonce = false;
    }

    return {
      success: true,
      results,
      operations: this.operations.length,
      completed: results.length,
      failed: 0,
      rollbackPerformed: false,
    };
  }

  private async rollback(): Promise<void> {
    const executedOps = this.operations.filter(op => op.executed && op.compensation);

    for (const op of executedOps.reverse()) {
      if (op.compensation) {
        try {
          await op.compensation();
        } catch (error) {
          console.error(`[UnitOfWork] Rollback error for ${op.type}:`, error);
        }
      }
    }
  }
}

const nonceManager = new NonceManager();
const gasEstimator = new GasEstimator();

export function getNonceManager(): NonceManager {
  return nonceManager;
}

export function getGasEstimator(): GasEstimator {
  return gasEstimator;
}

export function isValidStellarAddress(address: string) {
  if (!address?.trim()) return false;
  return StellarSdk.StrKey.isValidEd25519PublicKey(address);
}

export function isValidTransactionHash(hash: string) {
  if (!hash?.trim()) return false;
  return /^[A-Fa-f0-9]{64}$/.test(hash);
}

function assertValidStellarAddress(address: string) {
  if (!isValidStellarAddress(address)) {
    throw new InvalidStellarInputError('Invalid Stellar address');
  }
}

function assertValidTransactionHash(hash: string) {
  if (!isValidTransactionHash(hash)) {
    throw new InvalidStellarInputError('Invalid transaction hash');
  }
}

export async function getAccountInfo(address: string) {
  assertValidStellarAddress(address);

  return withQueryProfiling(
    `getAccountInfo(${address})`,
    'stellar.service',
    async () => {
      const account = await server.loadAccount(address);
      return {
        address: account.accountId(),
        balances: account.balances.map((b) => ({
          type: b.asset_type,
          balance: b.balance,
        })),
        sequence: account.sequence,
      };
    },
  );
}

export async function getTransactionStatus(hash: string) {
  assertValidTransactionHash(hash);

  return withQueryProfiling(
    `getTransactionStatus(${hash})`,
    'stellar.service',
    async () => {
      const tx = await server.transactions().transaction(hash).call();
      return {
        hash: tx.hash,
        successful: tx.successful,
        ledger: tx.ledger_attr,
        createdAt: tx.created_at,
        memo: tx.memo,
        operationCount: tx.operation_count,
      };
    },
  );
}

export async function estimateFee(operations = 1) {
  return gasEstimator.estimateFee(operations);
}

export function createUnitOfWork(): UnitOfWork {
  return new UnitOfWork();
}
