/**
 * confirmation-tracker.ts — Issue #514
 *
 * Tracks on-chain confirmation counts per transaction with configurable
 * safety thresholds per network. A transaction is considered final only when
 * its confirmation depth exceeds the network-specific safety threshold.
 *
 * Default thresholds (per issue spec):
 *   Ethereum  — 12 blocks
 *   Polygon   — 64 blocks
 *   Stellar   — 1 ledger (BFT finality)
 */

import { randomUUID } from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConfirmationThresholds {
  [network: string]: number;
}

export interface ConfirmedTx {
  id: string;
  txHash: string;
  network: string;
  confirmedAtBlock: number;
  firstSeenAt: string;
}

export interface ConfirmationStatus {
  txHash: string;
  network: string;
  confirmedAtBlock: number;
  currentBlock: number;
  confirmations: number;
  required: number;
  isFinalized: boolean;
}

export interface TrackerOptions {
  thresholds?: ConfirmationThresholds;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_THRESHOLDS: ConfirmationThresholds = {
  ethereum: 12,
  polygon: 64,
  stellar: 1,
  default: 12,
};

// ── ConfirmationTracker ───────────────────────────────────────────────────────

export class ConfirmationTracker {
  private thresholds: ConfirmationThresholds;
  private confirmedTxs = new Map<string, ConfirmedTx>();
  private networkHeads = new Map<string, number>();

  constructor(opts: TrackerOptions = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds ?? {}) };
  }

  getThreshold(network: string): number {
    return this.thresholds[network.toLowerCase()] ?? this.thresholds['default'] ?? 12;
  }

  /** Update the canonical head block for a network. */
  setNetworkHead(network: string, blockNumber: number): void {
    this.networkHeads.set(network.toLowerCase(), blockNumber);
  }

  getNetworkHead(network: string): number {
    return this.networkHeads.get(network.toLowerCase()) ?? 0;
  }

  /**
   * Record that a transaction was included in a specific block.
   * Call this when you first see the tx confirmed on-chain.
   */
  recordConfirmation(txHash: string, network: string, blockNumber: number): ConfirmedTx {
    const key = this.key(txHash, network);
    const existing = this.confirmedTxs.get(key);
    if (existing) return existing;

    const entry: ConfirmedTx = {
      id: randomUUID(),
      txHash,
      network: network.toLowerCase(),
      confirmedAtBlock: blockNumber,
      firstSeenAt: new Date().toISOString(),
    };
    this.confirmedTxs.set(key, entry);
    return entry;
  }

  /** Remove a transaction from tracking (e.g. after reorg orphans it). */
  removeConfirmation(txHash: string, network: string): void {
    this.confirmedTxs.delete(this.key(txHash, network));
  }

  /** Get the current confirmation status of a transaction. */
  getStatus(txHash: string, network: string): ConfirmationStatus | null {
    const entry = this.confirmedTxs.get(this.key(txHash, network));
    if (!entry) return null;

    const currentBlock = this.getNetworkHead(network);
    const confirmations = currentBlock >= entry.confirmedAtBlock
      ? currentBlock - entry.confirmedAtBlock + 1
      : 0;
    const required = this.getThreshold(network);

    return {
      txHash,
      network: network.toLowerCase(),
      confirmedAtBlock: entry.confirmedAtBlock,
      currentBlock,
      confirmations,
      required,
      isFinalized: confirmations >= required,
    };
  }

  /** Returns true only when confirmation count >= safety threshold. */
  isFinalized(txHash: string, network: string): boolean {
    return this.getStatus(txHash, network)?.isFinalized ?? false;
  }

  /** List all tracked transactions for a given network. */
  listByNetwork(network: string): ConfirmedTx[] {
    const net = network.toLowerCase();
    return Array.from(this.confirmedTxs.values()).filter((t) => t.network === net);
  }

  /** Identify transactions in orphaned blocks (block range [fromBlock, toBlock]). */
  findAffected(network: string, fromBlock: number, toBlock: number): ConfirmedTx[] {
    const net = network.toLowerCase();
    return Array.from(this.confirmedTxs.values()).filter(
      (t) =>
        t.network === net &&
        t.confirmedAtBlock >= fromBlock &&
        t.confirmedAtBlock <= toBlock,
    );
  }

  private key(txHash: string, network: string): string {
    return `${network.toLowerCase()}:${txHash}`;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _tracker: ConfirmationTracker | undefined;

export function getConfirmationTracker(): ConfirmationTracker {
  if (!_tracker) {
    _tracker = new ConfirmationTracker({
      thresholds: {
        ethereum: Number(process.env.CONFIRMATION_THRESHOLD_ETHEREUM ?? 12),
        polygon: Number(process.env.CONFIRMATION_THRESHOLD_POLYGON ?? 64),
        stellar: Number(process.env.CONFIRMATION_THRESHOLD_STELLAR ?? 1),
      },
    });
  }
  return _tracker;
}
