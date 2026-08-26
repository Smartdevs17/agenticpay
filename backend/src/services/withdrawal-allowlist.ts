/**
 * Withdrawal allowlist service — Issue #519
 *
 * Restricts withdrawal destinations per wallet to a configured allowlist.
 * Withdrawals to a non-allowlisted address require multi-signature approval
 * before they can execute. Velocity checks cap the amount and count of
 * withdrawals within rolling time windows, independent of destination.
 */

import { randomUUID } from 'node:crypto';

export interface AllowlistEntry {
  address: string;
  label?: string;
  addedAt: number;
  addedBy: string;
}

export interface VelocityLimits {
  maxAmountPerDay: number;
  maxAmountPerHour: number;
  maxCountPerHour: number;
}

export const DEFAULT_VELOCITY_LIMITS: VelocityLimits = {
  maxAmountPerDay: 50_000,
  maxAmountPerHour: 10_000,
  maxCountPerHour: 5,
};

export interface WalletWithdrawalConfig {
  walletId: string;
  allowlist: AllowlistEntry[];
  approvalThreshold: number;
  approvers: string[];
  velocityLimits: VelocityLimits;
}

export type WithdrawalStatus = 'pending_approval' | 'approved' | 'executed' | 'rejected' | 'blocked_velocity';

export interface WithdrawalRequest {
  id: string;
  walletId: string;
  toAddress: string;
  amount: number;
  currency: string;
  requestedBy: string;
  status: WithdrawalStatus;
  isAllowlisted: boolean;
  approvals: string[];
  rejections: string[];
  createdAt: number;
  updatedAt: number;
  executedTxHash?: string;
  blockReason?: string;
}

const walletConfigs = new Map<string, WalletWithdrawalConfig>();
const withdrawalRequests = new Map<string, WithdrawalRequest>();

function getOrCreateConfig(walletId: string): WalletWithdrawalConfig {
  let cfg = walletConfigs.get(walletId);
  if (!cfg) {
    cfg = {
      walletId,
      allowlist: [],
      approvalThreshold: 1,
      approvers: [],
      velocityLimits: { ...DEFAULT_VELOCITY_LIMITS },
    };
    walletConfigs.set(walletId, cfg);
  }
  return cfg;
}

export function configureWallet(
  walletId: string,
  params: { approvalThreshold?: number; approvers?: string[]; velocityLimits?: Partial<VelocityLimits> }
): WalletWithdrawalConfig {
  const cfg = getOrCreateConfig(walletId);
  if (params.approvalThreshold !== undefined) cfg.approvalThreshold = params.approvalThreshold;
  if (params.approvers !== undefined) cfg.approvers = params.approvers;
  if (params.velocityLimits) cfg.velocityLimits = { ...cfg.velocityLimits, ...params.velocityLimits };
  walletConfigs.set(walletId, cfg);
  return cfg;
}

export function getWalletConfig(walletId: string): WalletWithdrawalConfig {
  return getOrCreateConfig(walletId);
}

export function addToAllowlist(walletId: string, address: string, addedBy: string, label?: string): AllowlistEntry {
  const cfg = getOrCreateConfig(walletId);
  const existing = cfg.allowlist.find((e) => e.address.toLowerCase() === address.toLowerCase());
  if (existing) return existing;

  const entry: AllowlistEntry = { address, label, addedAt: Date.now(), addedBy };
  cfg.allowlist.push(entry);
  walletConfigs.set(walletId, cfg);
  return entry;
}

export function removeFromAllowlist(walletId: string, address: string): boolean {
  const cfg = getOrCreateConfig(walletId);
  const before = cfg.allowlist.length;
  cfg.allowlist = cfg.allowlist.filter((e) => e.address.toLowerCase() !== address.toLowerCase());
  walletConfigs.set(walletId, cfg);
  return cfg.allowlist.length < before;
}

export function isAllowlisted(walletId: string, address: string): boolean {
  const cfg = getOrCreateConfig(walletId);
  return cfg.allowlist.some((e) => e.address.toLowerCase() === address.toLowerCase());
}

// ---------------------------------------------------------------------------
// Velocity checks
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function executedWithdrawalsSince(walletId: string, sinceMs: number): WithdrawalRequest[] {
  return Array.from(withdrawalRequests.values()).filter(
    (w) => w.walletId === walletId && w.status === 'executed' && w.createdAt >= sinceMs
  );
}

export interface VelocityCheckResult {
  allowed: boolean;
  reason?: string;
}

export function checkVelocity(walletId: string, amount: number): VelocityCheckResult {
  const cfg = getOrCreateConfig(walletId);
  const now = Date.now();

  const lastHour = executedWithdrawalsSince(walletId, now - HOUR_MS);
  const lastDay = executedWithdrawalsSince(walletId, now - DAY_MS);

  const hourAmount = lastHour.reduce((sum, w) => sum + w.amount, 0) + amount;
  const dayAmount = lastDay.reduce((sum, w) => sum + w.amount, 0) + amount;

  if (lastHour.length + 1 > cfg.velocityLimits.maxCountPerHour) {
    return { allowed: false, reason: `Exceeds max ${cfg.velocityLimits.maxCountPerHour} withdrawals per hour` };
  }
  if (hourAmount > cfg.velocityLimits.maxAmountPerHour) {
    return { allowed: false, reason: `Exceeds hourly withdrawal limit of ${cfg.velocityLimits.maxAmountPerHour}` };
  }
  if (dayAmount > cfg.velocityLimits.maxAmountPerDay) {
    return { allowed: false, reason: `Exceeds daily withdrawal limit of ${cfg.velocityLimits.maxAmountPerDay}` };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Withdrawal request lifecycle
// ---------------------------------------------------------------------------

export function createWithdrawalRequest(params: {
  walletId: string;
  toAddress: string;
  amount: number;
  currency: string;
  requestedBy: string;
}): WithdrawalRequest {
  const cfg = getOrCreateConfig(params.walletId);
  const allowlisted = isAllowlisted(params.walletId, params.toAddress);
  const velocity = checkVelocity(params.walletId, params.amount);

  const now = Date.now();
  const request: WithdrawalRequest = {
    id: randomUUID(),
    walletId: params.walletId,
    toAddress: params.toAddress,
    amount: params.amount,
    currency: params.currency,
    requestedBy: params.requestedBy,
    status: 'pending_approval',
    isAllowlisted: allowlisted,
    approvals: [],
    rejections: [],
    createdAt: now,
    updatedAt: now,
  };

  if (!velocity.allowed) {
    request.status = 'blocked_velocity';
    request.blockReason = velocity.reason;
    withdrawalRequests.set(request.id, request);
    return request;
  }

  // Allowlisted destinations under threshold-1 approvals skip multisig review.
  if (allowlisted && cfg.approvalThreshold <= 1) {
    request.status = 'approved';
  }

  withdrawalRequests.set(request.id, request);
  return request;
}

export function getWithdrawalRequest(id: string): WithdrawalRequest | undefined {
  return withdrawalRequests.get(id);
}

export function listWithdrawalRequests(walletId?: string): WithdrawalRequest[] {
  const all = Array.from(withdrawalRequests.values());
  return walletId ? all.filter((w) => w.walletId === walletId) : all;
}

export class WithdrawalApprovalError extends Error {}

export function approveWithdrawal(id: string, approver: string): WithdrawalRequest {
  const request = withdrawalRequests.get(id);
  if (!request) throw new WithdrawalApprovalError('Withdrawal request not found');
  if (request.status !== 'pending_approval') {
    throw new WithdrawalApprovalError(`Cannot approve a request in status '${request.status}'`);
  }

  const cfg = getOrCreateConfig(request.walletId);
  if (cfg.approvers.length > 0 && !cfg.approvers.includes(approver)) {
    throw new WithdrawalApprovalError(`'${approver}' is not an authorized approver for this wallet`);
  }
  if (!request.approvals.includes(approver)) {
    request.approvals.push(approver);
  }

  if (request.approvals.length >= cfg.approvalThreshold) {
    request.status = 'approved';
  }
  request.updatedAt = Date.now();
  withdrawalRequests.set(id, request);
  return request;
}

export function rejectWithdrawal(id: string, approver: string): WithdrawalRequest {
  const request = withdrawalRequests.get(id);
  if (!request) throw new WithdrawalApprovalError('Withdrawal request not found');
  if (request.status !== 'pending_approval') {
    throw new WithdrawalApprovalError(`Cannot reject a request in status '${request.status}'`);
  }

  request.rejections.push(approver);
  request.status = 'rejected';
  request.updatedAt = Date.now();
  withdrawalRequests.set(id, request);
  return request;
}

export function markExecuted(id: string, txHash: string): WithdrawalRequest {
  const request = withdrawalRequests.get(id);
  if (!request) throw new WithdrawalApprovalError('Withdrawal request not found');
  if (request.status !== 'approved') {
    throw new WithdrawalApprovalError(`Cannot execute a request in status '${request.status}'`);
  }

  request.status = 'executed';
  request.executedTxHash = txHash;
  request.updatedAt = Date.now();
  withdrawalRequests.set(id, request);
  return request;
}

/** Test/maintenance helper to reset in-memory state between test runs */
export function resetWithdrawalAllowlistStore(): void {
  walletConfigs.clear();
  withdrawalRequests.clear();
}
