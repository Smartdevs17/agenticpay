import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as StellarSdk from '@stellar/stellar-sdk';
import { config } from '../config/env.js';
import { withQueryProfiling } from '../config/database.js';
import { withCircuitBreaker, CircuitBreakerError } from '../middleware/circuit-breaker.js';

const NETWORK = config().STELLAR_NETWORK;
const HORIZON_URL =
  NETWORK === 'public'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';

const STELLAR_CIRCUIT_NAME = 'stellar-horizon';

const serverOptions: StellarSdk.Horizon.Server.Options = {};

export const server = new StellarSdk.Horizon.Server(HORIZON_URL, serverOptions);

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

interface NonceWaiter {
  resolve: (seq: string) => void;
  reject: (err: Error) => void;
}

interface NonceState {
  current: string;
  /** Sequence numbers currently in-flight (issued but not yet confirmed). */
  inFlight: Set<string>;
  /** Mutex queue: waiters blocked until the lock is free. */
  waiters: NonceWaiter[];
  locked: boolean;
  lastUsedAt: number;
  /** Sequence number confirmed on-chain at last sync (for reorg detection). */
  confirmedSequence: string;
  /** Timestamp of last on-chain sync. */
  lastSyncAt: number;
}

/**
 * Concurrent-safe nonce manager for Stellar sequence numbers.
 *
 * Key improvements over the original:
 *  - Mutex queue: concurrent callers wait instead of throwing immediately,
 *    so parallel operations serialize correctly without external locking.
 *  - In-flight tracking: issued sequence numbers are tracked until confirmed
 *    or failed, enabling gap detection after partial failures.
 *  - Gap healing: after a failed transaction the manager re-syncs from
 *    Horizon so the next caller gets the correct on-chain sequence rather
 *    than a stale in-memory value.
 *  - Chain reorg detection: if the confirmed on-chain sequence regresses
 *    (reorg) the cache is invalidated and re-fetched.
 *  - Configurable acquire timeout to prevent indefinite waits.
 */
class NonceManager {
  private nonces = new Map<string, NonceState>();
  private maxRetries = 3;
  private retryDelayMs = 1000;
  /** Max time (ms) a caller will wait to acquire the nonce lock. */
  private acquireTimeoutMs = 15_000;
  /** Re-sync from chain if cached sequence is older than this. */
  private syncTtlMs = 60_000;

  // ── Acquire ────────────────────────────────────────────────────────────────

  /**
   * Acquire the next sequence number for `address`.
   *
   * If another caller already holds the lock the request is queued and
   * resolved in FIFO order once the lock is released.  Throws if the
   * queue wait exceeds `acquireTimeoutMs`.
   */
  async acquire(address: string): Promise<string> {
    const state = this.getOrCreate(address);

    if (state.locked) {
      // Queue this caller and wait for the lock to be released.
      const seq = await this.waitForLock(address);
      return seq;
    }

    return this.doAcquire(address, state);
  }

  private async doAcquire(address: string, state: NonceState): Promise<string> {
    state.locked = true;
    state.lastUsedAt = Date.now();

    const needsSync =
      state.lastSyncAt === 0 ||
      Date.now() - state.lastSyncAt > this.syncTtlMs;

    if (needsSync) {
      try {
        const account = await withCircuitBreaker(
          STELLAR_CIRCUIT_NAME,
          () => server.loadAccount(address),
        );
        const onChainSeq = account.sequence;

        // Reorg detection: on-chain sequence should never go backwards.
        if (
          state.confirmedSequence !== '0' &&
          BigInt(onChainSeq) < BigInt(state.confirmedSequence)
        ) {
          console.warn(
            `[NonceManager] Chain reorg detected for ${address}: ` +
            `on-chain=${onChainSeq} < confirmed=${state.confirmedSequence}. ` +
            `Invalidating in-flight set.`,
          );
          state.inFlight.clear();
        }

        // `account.sequence` is the last *used* sequence number on-chain.
        // The next valid sequence to submit is sequence + 1.
        state.current = onChainSeq;
        state.confirmedSequence = onChainSeq;
        state.lastSyncAt = Date.now();
      } catch (error) {
        // Release the lock before throwing so waiters aren't permanently blocked.
        state.locked = false;
        // Notify waiters of the failure by rejecting them — drain with error.
        this.rejectWaiters(address, error instanceof Error ? error : new Error(String(error)));
        if (error instanceof CircuitBreakerError) {
          throw new UnitOfWorkError(
            `Stellar Horizon unavailable: ${error.message}`,
            'acquire-nonce',
            error,
          );
        }
        throw new UnitOfWorkError(
          `Failed to acquire nonce for ${address}`,
          'acquire-nonce',
          error instanceof Error ? error : undefined,
        );
      }
    }

    // `state.current` holds the last confirmed on-chain sequence.
    // Compute the next sequence to issue: start at current+1 and skip
    // any slots already in-flight to avoid collisions.
    let next = BigInt(state.current) + 1n;
    while (state.inFlight.has(next.toString())) {
      next += 1n;
    }
    const issued = next.toString();
    state.inFlight.add(issued);
    // Do NOT update state.current here — it tracks the on-chain confirmed
    // value, not the highest issued value. increment() handles local advancement
    // for the sequential UnitOfWork path.
    return issued;
  }

  private waitForLock(address: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const waiter: NonceWaiter = {
        resolve,
        reject,
      };

      const timer = setTimeout(() => {
        const state = this.nonces.get(address);
        if (state) {
          state.waiters = state.waiters.filter((w) => w !== waiter);
        }
        reject(
          new UnitOfWorkError(
            `Nonce acquire timeout for ${address} after ${this.acquireTimeoutMs}ms`,
            'acquire-nonce',
          ),
        );
      }, this.acquireTimeoutMs);

      // Wrap resolve/reject to clear the timeout.
      waiter.resolve = (seq: string) => { clearTimeout(timer); resolve(seq); };
      waiter.reject = (err: Error) => { clearTimeout(timer); reject(err); };

      this.getOrCreate(address).waiters.push(waiter);
    });
  }

  // ── Release ────────────────────────────────────────────────────────────────

  /**
   * Release the lock and hand it to the next waiter (if any).
   * Call this after a transaction is confirmed OR after a failure
   * (paired with `markFailed` to heal the gap).
   */
  release(address: string): void {
    const state = this.nonces.get(address);
    if (!state) return;
    state.locked = false;
    state.lastUsedAt = Date.now();
    this.drainWaiters(address);
  }

  /**
   * Mark a sequence number as failed so it is removed from in-flight
   * tracking and the gap is healed on the next acquire.
   */
  markFailed(address: string, sequence: string): void {
    const state = this.nonces.get(address);
    if (!state) return;
    state.inFlight.delete(sequence);
    // Force a re-sync on next acquire so we get the real on-chain value.
    state.lastSyncAt = 0;
  }

  /**
   * Mark a sequence number as confirmed on-chain.
   * Updates the confirmed watermark used for reorg detection.
   */
  markConfirmed(address: string, sequence: string): void {
    const state = this.nonces.get(address);
    if (!state) return;
    state.inFlight.delete(sequence);
    if (BigInt(sequence) > BigInt(state.confirmedSequence)) {
      state.confirmedSequence = sequence;
    }
  }

  // ── Increment (legacy compat) ──────────────────────────────────────────────

  /** Advance the local sequence counter by one (used by UnitOfWork). */
  increment(address: string): void {
    const state = this.nonces.get(address);
    if (state) {
      const seqNum = BigInt(state.current);
      state.current = (seqNum + 1n).toString();
    }
  }

  // ── Conflict resolution ────────────────────────────────────────────────────

  /**
   * Force a re-sync from Horizon and re-acquire the lock.
   * Used when a transaction is rejected due to a bad sequence number.
   */
  async resolveConflict(address: string): Promise<string> {
    const state = this.getOrCreate(address);
    // Clear in-flight set — we don't know which ones landed.
    state.inFlight.clear();
    state.lastSyncAt = 0;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const account = await withCircuitBreaker(
          STELLAR_CIRCUIT_NAME,
          () => server.loadAccount(address),
        );
        state.current = account.sequence;
        state.confirmedSequence = account.sequence;
        state.lastSyncAt = Date.now();
        state.locked = true;
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

  // ── Inspection ─────────────────────────────────────────────────────────────

  getState(address: string): NonceState | undefined {
    return this.nonces.get(address);
  }

  /** Return a snapshot of in-flight sequence numbers for an address. */
  getInFlight(address: string): string[] {
    return Array.from(this.nonces.get(address)?.inFlight ?? []);
  }

  cleanup(olderThanMs = 300_000): void {
    const cutoff = Date.now() - olderThanMs;
    for (const [address, state] of this.nonces.entries()) {
      if (!state.locked && state.inFlight.size === 0 && state.lastUsedAt < cutoff) {
        this.nonces.delete(address);
      }
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private getOrCreate(address: string): NonceState {
    let state = this.nonces.get(address);
    if (!state) {
      state = {
        current: '0',
        inFlight: new Set(),
        waiters: [] as NonceWaiter[],
        locked: false,
        lastUsedAt: 0,
        confirmedSequence: '0',
        lastSyncAt: 0,
      };
      this.nonces.set(address, state);
    }
    return state;
  }

  /**
   * Hand the lock to the next waiter in the queue, or leave it unlocked
   * if the queue is empty.
   */
  private drainWaiters(address: string): void {
    const state = this.nonces.get(address);
    if (!state || state.waiters.length === 0) return;

    const next = state.waiters.shift()!;
    // Re-acquire on behalf of the next waiter.
    this.doAcquire(address, state)
      .then((seq) => next.resolve(seq))
      .catch((err: Error) => {
        // Propagate the error to this waiter; remaining waiters will be
        // rejected by rejectWaiters (called from doAcquire's error path).
        next.reject(err);
      });
  }

  /**
   * Reject all queued waiters with the given error.
   * Called when a sync failure makes it impossible to serve any waiter.
   */
  private rejectWaiters(address: string, err: Error): void {
    const state = this.nonces.get(address);
    if (!state) return;
    const waiters = state.waiters.splice(0);
    for (const w of waiters) {
      w.reject(err);
    }
  }
}

/** One historical fee sample. */
interface FeeSample {
  baseFee: number;
  ledger: number;
  sampledAt: number;
}

/**
 * Gas estimator with historical fee analysis and stuck-transaction support.
 *
 * Improvements over the original:
 *  - Rolling history window (last N samples) for percentile-based estimates.
 *  - Surge detection uses a configurable threshold rather than a hard-coded
 *    1000-stroop value.
 *  - `estimateFeeForConfirmation` returns a fee tuned to a target confirmation
 *    speed (fast / standard / slow) based on historical percentiles.
 *  - `replacementFee` computes the minimum fee needed to replace a stuck
 *    transaction (Stellar requires ≥ current fee + 1 stroop per operation).
 *  - `isStuck` heuristic: a transaction is considered stuck when it has been
 *    pending for longer than `stuckThresholdMs` (default 60 s).
 */
class GasEstimator {
  private baseFee = 100;
  private surgeMultiplier = 1.0;
  private maxMultiplier = 5.0;
  private estimateTimestamp = 0;
  private estimateTtlMs = 30_000;

  /** Rolling history of fee samples for percentile analysis. */
  private history: FeeSample[] = [];
  private readonly maxHistorySize = 100;
  /** Surge threshold in stroops (fees above this trigger the surge multiplier). */
  private readonly surgeThreshold = 500;
  /** A transaction pending longer than this is considered stuck. */
  private readonly stuckThresholdMs = 60_000;

  // ── Core estimate ──────────────────────────────────────────────────────────

  async estimateFee(operations: number): Promise<{
    recommended: number;
    min: number;
    max: number;
    surge: boolean;
  }> {
    await this.refreshIfStale();

    const baseOps = this.baseFee * operations;
    const recommended = Math.ceil(baseOps * this.surgeMultiplier);
    const min = this.baseFee * operations;
    const max = Math.ceil(this.baseFee * this.maxMultiplier * operations);

    return { recommended, min, max, surge: this.surgeMultiplier > 1.0 };
  }

  // ── Historical analysis ────────────────────────────────────────────────────

  /**
   * Return a fee estimate tuned to a desired confirmation speed.
   *
   * - `fast`     → p90 of recent fees (high chance of next-ledger inclusion)
   * - `standard` → p50 (median, typical confirmation in 1-3 ledgers)
   * - `slow`     → p10 (cheapest, may take several ledgers)
   */
  async estimateFeeForConfirmation(
    operations: number,
    speed: 'fast' | 'standard' | 'slow' = 'standard',
  ): Promise<{ fee: number; speed: string; percentile: number; surge: boolean }> {
    await this.refreshIfStale();

    const percentile = speed === 'fast' ? 90 : speed === 'standard' ? 50 : 10;
    const historicalBase = this.percentileFee(percentile);
    const base = Math.max(historicalBase, this.baseFee);
    const fee = Math.ceil(base * operations * this.surgeMultiplier);

    return { fee, speed, percentile, surge: this.surgeMultiplier > 1.0 };
  }

  /**
   * Return the fee history as an array of { ledger, baseFee, sampledAt }
   * objects, useful for trend visualisation.
   */
  getFeeHistory(): FeeSample[] {
    return [...this.history];
  }

  /**
   * Compute the p-th percentile base fee from the rolling history.
   * Falls back to `this.baseFee` when history is empty.
   */
  percentileFee(p: number): number {
    if (this.history.length === 0) return this.baseFee;
    const sorted = [...this.history].map((s) => s.baseFee).sort((a, b) => a - b);
    const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[idx];
  }

  // ── Stuck-transaction helpers ──────────────────────────────────────────────

  /**
   * Returns `true` when a transaction submitted at `submittedAt` has been
   * pending for longer than the stuck threshold.
   */
  isStuck(submittedAt: number): boolean {
    return Date.now() - submittedAt > this.stuckThresholdMs;
  }

  /**
   * Compute the replacement fee for a stuck transaction.
   *
   * Stellar's fee-bump mechanism requires the new fee to be strictly
   * greater than the original.  We apply a configurable bump factor
   * (default 1.5×) on top of the current recommended fee, ensuring the
   * replacement is competitive even if the network has surged since the
   * original submission.
   *
   * @param originalFeePerOp  The per-operation fee of the stuck transaction.
   * @param operations        Number of operations in the transaction.
   * @param bumpFactor        Multiplier applied to the recommended fee (≥ 1.0).
   */
  async replacementFee(
    originalFeePerOp: number,
    operations: number,
    bumpFactor = 1.5,
  ): Promise<{ replacementFee: number; originalFee: number; bump: number }> {
    await this.refreshIfStale();

    const originalFee = originalFeePerOp * operations;
    const currentRecommended = Math.ceil(this.baseFee * operations * this.surgeMultiplier);
    // Must exceed the original; also apply the bump to the current recommended.
    const replacement = Math.max(
      originalFee + 1,
      Math.ceil(currentRecommended * Math.max(1.0, bumpFactor)),
    );

    return { replacementFee: replacement, originalFee, bump: replacement / originalFee };
  }

  // ── Legacy helper ──────────────────────────────────────────────────────────

  /** Bump a fee by 20% (used by UnitOfWork retry logic). */
  priceBump(currentFee: number): number {
    return Math.ceil(currentFee * 1.2);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async refreshIfStale(): Promise<void> {
    const now = Date.now();
    if (now - this.estimateTimestamp <= this.estimateTtlMs) return;

    try {
      const feeStats = await withCircuitBreaker(
        STELLAR_CIRCUIT_NAME,
        () => server.feeStats(),
        async () => ({ max_fee: { mode: '100' }, last_ledger: '0' }),
      );

      const modeStr = feeStats.max_fee?.mode ?? '100';
      const newBase = parseInt(modeStr, 10) || 100;
      const ledger = parseInt((feeStats as any).last_ledger ?? '0', 10);

      this.baseFee = newBase;
      this.estimateTimestamp = now;
      this.surgeMultiplier = newBase > this.surgeThreshold ? 2.0 : 1.0;

      // Record sample in rolling history.
      this.history.push({ baseFee: newBase, ledger, sampledAt: now });
      if (this.history.length > this.maxHistorySize) {
        this.history.shift();
      }
    } catch {
      // Reset timestamp so the next call retries rather than serving a
      // stale value for the full TTL window.
      this.estimateTimestamp = 0;
      this.baseFee = Math.max(this.baseFee, 100);
    }
  }
}

export class UnitOfWork {
  private operations: Array<{
    type: string;
    fn: () => Promise<string>;
    compensation?: () => Promise<void>;
    /** When true this operation can run in parallel with other independent ops. */
    independent?: boolean;
    executed: boolean;
    result?: string;
    sequence?: string;
  }> = [];

  private completed: OperationResult[] = [];
  private rollbackPerformed = false;
  private nonceManager: NonceManager;
  private gasEstimator: GasEstimator;
  private sourceAddress?: string;

  constructor() {
    this.nonceManager = getNonceManager();
    this.gasEstimator = getGasEstimator();
  }

  setSourceAddress(address: string): this {
    this.sourceAddress = address;
    return this;
  }

  addOperation(
    type: string,
    fn: () => Promise<string>,
    compensation?: () => Promise<void>,
    options: { independent?: boolean } = {},
  ): this {
    this.operations.push({
      type,
      fn,
      compensation,
      independent: options.independent ?? false,
      executed: false,
    });
    return this;
  }

  /**
   * Execute all operations.
   *
   * Independent operations (flagged with `independent: true`) are submitted
   * in parallel — each gets its own sequence number issued up-front before
   * any of them fires, so they can all be in-flight simultaneously without
   * colliding.  Dependent operations run sequentially; each acquires its
   * sequence only after the previous one completes.
   *
   * On any failure the already-executed operations are rolled back and all
   * in-flight sequence numbers are marked failed so the nonce manager can
   * heal the gap on the next acquire.
   */
  async commit(): Promise<UnitOfWorkResult> {
    const results: OperationResult[] = [];

    // Partition up-front so we know what we're dealing with.
    const independentOps = this.operations.filter((op) => op.independent);
    const dependentOps   = this.operations.filter((op) => !op.independent);

    // ── Parallel path ──────────────────────────────────────────────────────
    if (independentOps.length > 0) {
      // Issue all sequence numbers before launching any operation so that
      // concurrent submissions don't race for the same slot.
      if (this.sourceAddress) {
        for (const op of independentOps) {
          try {
            op.sequence = await this.nonceManager.acquire(this.sourceAddress);
          } catch (error) {
            // If we can't get a sequence for even one op, abort everything.
            // Release any sequences already issued.
            for (const issued of independentOps) {
              if (issued.sequence && this.sourceAddress) {
                this.nonceManager.markFailed(this.sourceAddress, issued.sequence);
                this.nonceManager.release(this.sourceAddress);
              }
            }
            return {
              success: false,
              results: [{
                operation: op.type,
                status: 'failed',
                error: error instanceof Error ? error.message : 'Failed to acquire nonce',
              }],
              operations: this.operations.length,
              completed: 0,
              failed: 1,
              rollbackPerformed: false,
            };
          }
        }
      }

      const parallelResults = await Promise.allSettled(
        independentOps.map((op) => this.runOperation(op)),
      );

      for (let i = 0; i < independentOps.length; i++) {
        const op      = independentOps[i];
        const outcome = parallelResults[i];
        if (outcome.status === 'fulfilled') {
          const r: OperationResult = { operation: op.type, status: 'success', txHash: outcome.value };
          results.push(r);
          this.completed.push(r);
          if (this.sourceAddress && op.sequence) {
            this.nonceManager.markConfirmed(this.sourceAddress, op.sequence);
            this.nonceManager.release(this.sourceAddress);
          }
        } else {
          const r: OperationResult = {
            operation: op.type,
            status: 'failed',
            error: outcome.reason instanceof Error ? outcome.reason.message : 'Unknown error',
          };
          results.push(r);
          this.completed.push(r);
          if (this.sourceAddress && op.sequence) {
            this.nonceManager.markFailed(this.sourceAddress, op.sequence);
            this.nonceManager.release(this.sourceAddress);
          }
        }
      }

      const anyFailed = results.some((r) => r.status === 'failed');
      if (anyFailed) {
        await this.rollback();
        return {
          success: false,
          results,
          operations: this.operations.length,
          completed: results.filter((r) => r.status === 'success').length,
          failed:    results.filter((r) => r.status === 'failed').length,
          rollbackPerformed: true,
        };
      }
    }

    // ── Sequential path ────────────────────────────────────────────────────
    for (const op of dependentOps) {
      // Acquire a fresh sequence for each sequential operation.
      if (this.sourceAddress) {
        try {
          op.sequence = await this.nonceManager.acquire(this.sourceAddress);
        } catch (error) {
          const r: OperationResult = {
            operation: op.type,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Failed to acquire nonce',
          };
          results.push(r);
          this.completed.push(r);
          await this.rollback();
          return {
            success: false,
            results,
            operations: this.operations.length,
            completed: this.completed.filter((r) => r.status === 'success').length,
            failed:    this.completed.filter((r) => r.status === 'failed').length,
            rollbackPerformed: true,
          };
        }
      }

      try {
        const txHash = await this.runOperation(op);
        const r: OperationResult = { operation: op.type, status: 'success', txHash };
        results.push(r);
        this.completed.push(r);
        if (this.sourceAddress && op.sequence) {
          this.nonceManager.markConfirmed(this.sourceAddress, op.sequence);
          this.nonceManager.release(this.sourceAddress);
        }
      } catch (error) {
        const r: OperationResult = {
          operation: op.type,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        results.push(r);
        this.completed.push(r);
        if (this.sourceAddress && op.sequence) {
          this.nonceManager.markFailed(this.sourceAddress, op.sequence);
          this.nonceManager.release(this.sourceAddress);
        }
        await this.rollback();
        return {
          success: false,
          results,
          operations: this.operations.length,
          completed: this.completed.filter((r) => r.status === 'success').length,
          failed:    this.completed.filter((r) => r.status === 'failed').length,
          rollbackPerformed: true,
        };
      }
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

  private async runOperation(op: typeof this.operations[number]): Promise<string> {
    const txHash = await op.fn();
    op.executed = true;
    op.result = txHash;
    return txHash;
  }

  private async rollback(): Promise<void> {
    const executedOps = this.operations.filter((op) => op.executed && op.compensation);
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

/** Expose estimateFeeForConfirmation at module level for convenience. */
export async function estimateFeeForConfirmation(
  operations: number,
  speed: 'fast' | 'standard' | 'slow' = 'standard',
) {
  return gasEstimator.estimateFeeForConfirmation(operations, speed);
}

/** Expose replacementFee at module level for stuck-tx handling. */
export async function computeReplacementFee(
  originalFeePerOp: number,
  operations: number,
  bumpFactor?: number,
) {
  return gasEstimator.replacementFee(originalFeePerOp, operations, bumpFactor);
}

/** Returns true when a transaction submitted at `submittedAt` is considered stuck. */
export function isTransactionStuck(submittedAt: number): boolean {
  return gasEstimator.isStuck(submittedAt);
}

/** Return the rolling fee history for trend analysis. */
export function getFeeHistory() {
  return gasEstimator.getFeeHistory();
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
      const account = await withCircuitBreaker(
        STELLAR_CIRCUIT_NAME,
        () => server.loadAccount(address),
      );
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
      const tx = await withCircuitBreaker(
        STELLAR_CIRCUIT_NAME,
        () => server.transactions().transaction(hash).call(),
      );
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

// ─── Contract build verification ─────────────────────────────────────────────
//
// The backend refuses to serve traffic when the bytecode deployed under the
// configured Soroban contract ID does not match the hash recorded in the build
// manifest generated by `scripts/verify-contract-hash.sh`. This closes the gap
// where a compromised or accidentally replaced contract would silently receive
// escrow operations from the API.

const DEFAULT_TESTNET_RPC_URL = 'https://soroban-testnet.stellar.org';
const MANIFEST_FILE_NAME = 'build-manifest.json';
const WASM_SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type ContractNetwork = 'testnet' | 'public';
export type ContractHashVerificationMode = 'enforce' | 'warn' | 'off';

export interface ContractBuildManifest {
  contractId: string;
  network: ContractNetwork;
  wasmSha256: string;
  wasmFile?: string;
  builtAt?: string;
}

export type ContractHashVerificationErrorCode =
  | 'MANIFEST_NOT_FOUND'
  | 'MANIFEST_INVALID'
  | 'MANIFEST_INVALID_CONTRACT_ID'
  | 'MANIFEST_INVALID_NETWORK'
  | 'MANIFEST_INVALID_HASH'
  | 'MANIFEST_CONTRACT_MISMATCH'
  | 'MANIFEST_NETWORK_MISMATCH'
  | 'INVALID_CONTRACT_ID'
  | 'INVALID_EXPECTED_HASH'
  | 'INVALID_VERIFICATION_MODE'
  | 'MISSING_RPC_URL'
  | 'WASM_FETCH_FAILED'
  | 'EMPTY_WASM'
  | 'HASH_MISMATCH'
  | 'VERIFICATION_FAILED';

export class ContractHashVerificationError extends Error {
  code: ContractHashVerificationErrorCode;

  constructor(message: string, code: ContractHashVerificationErrorCode) {
    super(message);
    this.name = 'ContractHashVerificationError';
    this.code = code;
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isValidContractId(contractId: string): boolean {
  if (!contractId?.trim()) {
    return false;
  }

  return StellarSdk.StrKey.isValidContract(contractId.trim());
}

/** SHA-256 of the raw WASM bytecode, hex encoded (the format Soroban uses). */
export function computeContractWasmHash(wasm: Uint8Array): string {
  return createHash('sha256').update(wasm).digest('hex');
}

export function parseContractBuildManifest(raw: string): ContractBuildManifest {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ContractHashVerificationError('Contract build manifest is not valid JSON', 'MANIFEST_INVALID');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ContractHashVerificationError('Contract build manifest must be a JSON object', 'MANIFEST_INVALID');
  }

  const record = parsed as Record<string, unknown>;
  const contractId = typeof record.contractId === 'string' ? record.contractId.trim() : '';
  const network = record.network;
  const wasmSha256 = typeof record.wasmSha256 === 'string' ? record.wasmSha256.trim().toLowerCase() : '';

  if (!contractId) {
    throw new ContractHashVerificationError('Contract build manifest is missing contractId', 'MANIFEST_INVALID');
  }
  if (!isValidContractId(contractId)) {
    throw new ContractHashVerificationError('Contract build manifest contains an invalid contractId', 'MANIFEST_INVALID_CONTRACT_ID');
  }
  if (network !== 'testnet' && network !== 'public') {
    throw new ContractHashVerificationError('Contract build manifest network must be "testnet" or "public"', 'MANIFEST_INVALID_NETWORK');
  }
  if (!WASM_SHA256_PATTERN.test(wasmSha256)) {
    throw new ContractHashVerificationError('Contract build manifest wasmSha256 must be a 64-character hex SHA-256 hash', 'MANIFEST_INVALID_HASH');
  }

  return {
    contractId,
    network,
    wasmSha256,
    wasmFile: typeof record.wasmFile === 'string' ? record.wasmFile : undefined,
    builtAt: typeof record.builtAt === 'string' ? record.builtAt : undefined,
  };
}

/** Resolves the manifest path, trying the repo root and the backend directory. */
export function resolveContractBuildManifestPath(explicit?: string): string {
  if (explicit?.trim()) {
    return path.resolve(process.cwd(), explicit.trim());
  }

  const candidates = [
    path.resolve(process.cwd(), 'contracts', MANIFEST_FILE_NAME),
    path.resolve(process.cwd(), '..', 'contracts', MANIFEST_FILE_NAME),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export async function loadContractBuildManifest(manifestPath: string): Promise<ContractBuildManifest> {
  let raw: string;

  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (error) {
    throw new ContractHashVerificationError(
      `Could not read contract build manifest at ${manifestPath}: ${toErrorMessage(error)}. ` +
        'Generate it with scripts/verify-contract-hash.sh --write.',
      'MANIFEST_NOT_FOUND'
    );
  }

  return parseContractBuildManifest(raw);
}

export interface ContractHashVerificationSettings {
  contractId: string;
  network: ContractNetwork;
  manifestPath: string;
  rpcUrl: string;
  mode: ContractHashVerificationMode;
}

export function resolveContractHashVerificationSettings(
  env: NodeJS.ProcessEnv = process.env
): ContractHashVerificationSettings {
  const network: ContractNetwork = env.STELLAR_NETWORK === 'public' ? 'public' : 'testnet';
  const rawMode = env.CONTRACT_HASH_VERIFICATION?.trim() || 'enforce';

  if (rawMode !== 'enforce' && rawMode !== 'warn' && rawMode !== 'off') {
    throw new ContractHashVerificationError(
      `Invalid CONTRACT_HASH_VERIFICATION value "${rawMode}"; expected "enforce", "warn" or "off"`,
      'INVALID_VERIFICATION_MODE'
    );
  }

  const rpcUrl = env.SOROBAN_RPC_URL?.trim() || (network === 'testnet' ? DEFAULT_TESTNET_RPC_URL : '');

  return {
    contractId: env.SOROBAN_CONTRACT_ID?.trim() ?? '',
    network,
    manifestPath: resolveContractBuildManifestPath(env.SOROBAN_BUILD_MANIFEST),
    rpcUrl,
    mode: rawMode,
  };
}

export async function fetchDeployedContractWasm(
  contractId: string,
  rpcUrl: string = resolveContractHashVerificationSettings().rpcUrl
): Promise<Uint8Array> {
  if (!rpcUrl) {
    throw new ContractHashVerificationError(
      'SOROBAN_RPC_URL must be configured to verify the contract hash on the public network',
      'MISSING_RPC_URL'
    );
  }

  const rpc = new StellarSdk.SorobanRpc.Server(rpcUrl);
  return rpc.getContractWasmByContractId(contractId);
}

export type ContractWasmFetcher = (contractId: string) => Promise<Uint8Array>;

export interface ContractHashVerificationResult {
  contractId: string;
  expectedSha256: string;
  actualSha256: string;
  verified: boolean;
}

/** Hashes the deployed WASM and compares it with the manifest hash. */
export async function verifyContractHash(
  contractId: string,
  expectedSha256: string,
  fetchWasm: ContractWasmFetcher = (id) => fetchDeployedContractWasm(id)
): Promise<ContractHashVerificationResult> {
  if (!isValidContractId(contractId)) {
    throw new ContractHashVerificationError('Invalid Soroban contract ID', 'INVALID_CONTRACT_ID');
  }

  const expected = expectedSha256?.trim().toLowerCase() ?? '';
  if (!WASM_SHA256_PATTERN.test(expected)) {
    throw new ContractHashVerificationError(
      'Expected WASM hash must be a 64-character hex SHA-256 hash',
      'INVALID_EXPECTED_HASH'
    );
  }

  let wasm: Uint8Array;
  try {
    wasm = await fetchWasm(contractId.trim());
  } catch (error) {
    throw new ContractHashVerificationError(
      `Failed to fetch deployed WASM for contract ${contractId}: ${toErrorMessage(error)}`,
      'WASM_FETCH_FAILED'
    );
  }

  if (!wasm || wasm.length === 0) {
    throw new ContractHashVerificationError(
      `Deployed contract ${contractId} returned empty WASM bytecode`,
      'EMPTY_WASM'
    );
  }

  const actualSha256 = computeContractWasmHash(wasm);

  return {
    contractId: contractId.trim(),
    expectedSha256: expected,
    actualSha256,
    verified: actualSha256 === expected,
  };
}

export type ContractHashStartupResult =
  | { status: 'verified'; contractId: string; wasmSha256: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

export interface ContractHashStartupOptions {
  env?: NodeJS.ProcessEnv;
  fetchWasm?: ContractWasmFetcher;
}

/**
 * Startup guard: verifies the manifest against the deployed contract bytecode.
 * Throws in `enforce` mode; logs and continues in `warn` mode.
 */
export async function verifyContractHashAtStartup(
  options: ContractHashStartupOptions = {}
): Promise<ContractHashStartupResult> {
  const settings = resolveContractHashVerificationSettings(options.env ?? process.env);

  if (settings.mode === 'off') {
    console.warn('[contract-hash] CONTRACT_HASH_VERIFICATION=off — skipping contract hash verification.');
    return { status: 'skipped', reason: 'verification disabled' };
  }

  if (!settings.contractId) {
    console.warn('[contract-hash] SOROBAN_CONTRACT_ID is not set — skipping contract hash verification.');
    return { status: 'skipped', reason: 'SOROBAN_CONTRACT_ID is not set' };
  }

  try {
    if (!settings.rpcUrl) {
      throw new ContractHashVerificationError(
        'SOROBAN_RPC_URL must be configured to verify the contract hash on the public network',
        'MISSING_RPC_URL'
      );
    }

    const manifest = await loadContractBuildManifest(settings.manifestPath);

    if (manifest.contractId !== settings.contractId) {
      throw new ContractHashVerificationError(
        `Build manifest is for contract ${manifest.contractId} but SOROBAN_CONTRACT_ID is ${settings.contractId}`,
        'MANIFEST_CONTRACT_MISMATCH'
      );
    }

    if (manifest.network !== settings.network) {
      throw new ContractHashVerificationError(
        `Build manifest targets ${manifest.network} but STELLAR_NETWORK is ${settings.network}`,
        'MANIFEST_NETWORK_MISMATCH'
      );
    }

    const fetchWasm =
      options.fetchWasm ?? ((id: string) => fetchDeployedContractWasm(id, settings.rpcUrl));
    const result = await verifyContractHash(settings.contractId, manifest.wasmSha256, fetchWasm);

    if (!result.verified) {
      throw new ContractHashVerificationError(
        `Contract ${result.contractId} WASM hash mismatch: manifest expects ${result.expectedSha256} ` +
          `but the deployed bytecode hashes to ${result.actualSha256}`,
        'HASH_MISMATCH'
      );
    }

    console.info(
      `[contract-hash] Verified deployed contract ${result.contractId} (${settings.network}) ` +
        `WASM sha256=${result.actualSha256}.`
    );

    return { status: 'verified', contractId: result.contractId, wasmSha256: result.actualSha256 };
  } catch (error) {
    const message = toErrorMessage(error);

    if (settings.mode === 'warn') {
      console.error(`[contract-hash] Verification failed; continuing because mode is "warn". ${message}`);
      return { status: 'failed', reason: message };
    }

    console.error(`[contract-hash] Verification failed; refusing to start. ${message}`);
    throw error instanceof ContractHashVerificationError
      ? error
      : new ContractHashVerificationError(message, 'VERIFICATION_FAILED');
  }
}
