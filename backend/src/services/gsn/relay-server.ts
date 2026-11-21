/**
 * GSN Meta-Transaction Relay Server
 *
 * Accepts EIP-2771 signed meta-transactions from users, validates signatures,
 * checks budget/rate-limits via the budget manager, submits transactions to
 * the chain, and handles EIP-1559 fee estimation with configurable multiplier.
 */

import { randomUUID } from 'node:crypto';
import { verifyBudget, recordGasSpend, getBudget } from './budget-manager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetaTransactionRequest {
  from: string;           // User wallet address (hex)
  to: string;             // Target contract address (hex)
  value: string;          // ETH value in wei (hex string)
  gas: string;            // Gas limit (hex string)
  nonce: string;          // User nonce (hex string)
  deadline: number;       // Unix timestamp
  data: string;           // Encoded calldata (hex)
  signature: string;      // EIP-712 signature (hex)
  chainId: number;
  merchantId: string;     // Which budget to debit
}

export type RelayStatus =
  | 'pending'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'rejected_budget'
  | 'rejected_signature'
  | 'rejected_rate_limit';

export interface RelayRecord {
  id: string;
  merchantId: string;
  userWallet: string;
  chainId: number;
  txHash?: string;
  status: RelayStatus;
  gasUsed?: number;
  effectiveGasPrice?: string;
  gasCostWei?: string;
  errorMessage?: string;
  submittedAt?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GasEstimate {
  baseFeePerGas: string;  // wei hex
  maxPriorityFeePerGas: string;
  maxFeePerGas: string;
  estimatedGasUnits: number;
  estimatedCostWei: string;
  estimatedCostUSD?: number;
}

// ---------------------------------------------------------------------------
// In-memory nonce store (replace with Redis in production)
// ---------------------------------------------------------------------------

const nonceStore = new Map<string, Map<number, Set<string>>>();

function isNonceUsed(wallet: string, chainId: number, nonce: string): boolean {
  const byChain = nonceStore.get(wallet.toLowerCase());
  if (!byChain) return false;
  return byChain.get(chainId)?.has(nonce) ?? false;
}

function markNonceUsed(wallet: string, chainId: number, nonce: string): void {
  const lower = wallet.toLowerCase();
  if (!nonceStore.has(lower)) nonceStore.set(lower, new Map());
  const byChain = nonceStore.get(lower)!;
  if (!byChain.has(chainId)) byChain.set(chainId, new Set());
  byChain.get(chainId)!.add(nonce);
}

// ---------------------------------------------------------------------------
// Relay records store
// ---------------------------------------------------------------------------

const relayRecords = new Map<string, RelayRecord>();

// ---------------------------------------------------------------------------
// EIP-1559 gas estimation
// ---------------------------------------------------------------------------

export interface GasEstimationConfig {
  baseFeeWei: bigint;
  priorityFeeWei: bigint;
  multiplier: number;      // e.g. 1.2 for 20% buffer
}

export function estimateEIP1559Gas(
  estimatedUnits: number,
  config: GasEstimationConfig,
  ethUsdPrice?: number
): GasEstimate {
  const { baseFeeWei, priorityFeeWei, multiplier } = config;

  const maxPriority = BigInt(Math.ceil(Number(priorityFeeWei) * multiplier));
  const maxFee = BigInt(Math.ceil(Number(baseFeeWei * 2n + priorityFeeWei) * multiplier));
  const effectiveGasPrice = baseFeeWei + maxPriority;
  const costWei = effectiveGasPrice * BigInt(estimatedUnits);

  const costUSD =
    ethUsdPrice != null
      ? (Number(costWei) / 1e18) * ethUsdPrice
      : undefined;

  return {
    baseFeePerGas: '0x' + baseFeeWei.toString(16),
    maxPriorityFeePerGas: '0x' + maxPriority.toString(16),
    maxFeePerGas: '0x' + maxFee.toString(16),
    estimatedGasUnits: estimatedUnits,
    estimatedCostWei: costWei.toString(),
    estimatedCostUSD: costUSD,
  };
}

// ---------------------------------------------------------------------------
// Signature validation (simplified — production uses ethers.js / viem)
// ---------------------------------------------------------------------------

function isValidHexSignature(sig: string): boolean {
  return /^0x[0-9a-fA-F]{130}$/.test(sig);
}

function isDeadlinePassed(deadline: number): boolean {
  return Date.now() / 1000 > deadline;
}

// ---------------------------------------------------------------------------
// Core relay logic
// ---------------------------------------------------------------------------

export async function submitMetaTransaction(
  req: MetaTransactionRequest,
  gasConfig: GasEstimationConfig,
  ethUsdPrice?: number
): Promise<RelayRecord> {
  const now = new Date().toISOString();
  const record: RelayRecord = {
    id: randomUUID(),
    merchantId: req.merchantId,
    userWallet: req.from.toLowerCase(),
    chainId: req.chainId,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  relayRecords.set(record.id, record);

  // Validate signature format
  if (!isValidHexSignature(req.signature)) {
    record.status = 'rejected_signature';
    record.errorMessage = 'Invalid EIP-712 signature format';
    record.updatedAt = new Date().toISOString();
    return record;
  }

  // Deadline check
  if (isDeadlinePassed(req.deadline)) {
    record.status = 'rejected_signature';
    record.errorMessage = 'Meta-transaction deadline has passed';
    record.updatedAt = new Date().toISOString();
    return record;
  }

  // Replay protection
  if (isNonceUsed(req.from, req.chainId, req.nonce)) {
    record.status = 'rejected_signature';
    record.errorMessage = 'Nonce already used (replay attempt)';
    record.updatedAt = new Date().toISOString();
    return record;
  }

  // Estimate gas
  const gasEstimate = estimateEIP1559Gas(
    parseInt(req.gas, 16) || 100_000,
    gasConfig,
    ethUsdPrice
  );

  // Budget check
  const budgetCheck = verifyBudget(req.merchantId, req.from, gasEstimate.estimatedGasUnits);
  if (!budgetCheck.allowed) {
    record.status = budgetCheck.reason === 'rate_limit_exceeded'
      ? 'rejected_rate_limit'
      : 'rejected_budget';
    record.errorMessage = budgetCheck.reason;
    record.updatedAt = new Date().toISOString();
    return record;
  }

  // Mark nonce used and submit
  markNonceUsed(req.from, req.chainId, req.nonce);

  record.status = 'submitted';
  record.submittedAt = new Date().toISOString();
  record.effectiveGasPrice = gasEstimate.maxFeePerGas;
  record.updatedAt = record.submittedAt;

  // Simulate on-chain submission result (replace with ethers.js contract call)
  const mockTxHash = '0x' + randomUUID().replace(/-/g, '') + '0000';
  record.txHash = mockTxHash;
  record.gasUsed = gasEstimate.estimatedGasUnits;
  record.gasCostWei = gasEstimate.estimatedCostWei;
  record.status = 'confirmed';
  record.confirmedAt = new Date().toISOString();
  record.updatedAt = record.confirmedAt;

  // Debit budget
  recordGasSpend(req.merchantId, req.from, gasEstimate.estimatedGasUnits, gasEstimate.estimatedCostWei);

  relayRecords.set(record.id, record);
  return record;
}

// ---------------------------------------------------------------------------
// Fallback: user pays gas
// ---------------------------------------------------------------------------

export function shouldFallbackToUserGas(merchantId: string): boolean {
  const budget = getBudget(merchantId);
  if (!budget) return true;
  return !budget.active || budget.availableWei === '0';
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export function getRelayRecord(id: string): RelayRecord | undefined {
  return relayRecords.get(id);
}

export function listRelayRecords(filters: {
  merchantId?: string;
  userWallet?: string;
  status?: RelayStatus;
} = {}): RelayRecord[] {
  return Array.from(relayRecords.values()).filter((r) => {
    if (filters.merchantId && r.merchantId !== filters.merchantId) return false;
    if (filters.userWallet && r.userWallet !== filters.userWallet.toLowerCase()) return false;
    if (filters.status && r.status !== filters.status) return false;
    return true;
  });
}
