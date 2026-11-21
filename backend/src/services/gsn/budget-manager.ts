/**
 * GSN Sponsorship Budget Manager
 *
 * Tracks per-merchant sponsorship budgets, enforces per-wallet rate limits,
 * bills gas costs, and provides billing summaries for merchant invoicing.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SponsorshipBudget {
  id: string;
  merchantId: string;
  totalDepositedWei: string;      // BigInt as string for JSON safety
  spentWei: string;
  availableWei: string;
  gasCapPerTx: number;            // Max gas units per transaction
  rateLimitPerDay: number;        // Max sponsored txs per wallet per day
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SponsorshipTx {
  id: string;
  merchantId: string;
  userWallet: string;
  gasUnits: number;
  gasCostWei: string;
  txHash?: string;
  chainId?: number;
  billedAt: string;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  remainingBudgetWei?: string;
  walletTxCountToday?: number;
}

// ---------------------------------------------------------------------------
// In-memory stores (swap for Prisma GasSponsorshipBudget / GasSponsorshipTx)
// ---------------------------------------------------------------------------

const budgets = new Map<string, SponsorshipBudget>();
const sponsorshipTxs: SponsorshipTx[] = [];

// Per-wallet daily usage: merchantId → wallet → { count, windowStart }
const walletDailyUsage = new Map<string, Map<string, { count: number; windowStart: number }>>();

// ---------------------------------------------------------------------------
// Budget CRUD
// ---------------------------------------------------------------------------

export function createBudget(
  merchantId: string,
  depositWei: string,
  gasCapPerTx: number,
  rateLimitPerDay: number
): SponsorshipBudget {
  const now = new Date().toISOString();
  const budget: SponsorshipBudget = {
    id: randomUUID(),
    merchantId,
    totalDepositedWei: depositWei,
    spentWei: '0',
    availableWei: depositWei,
    gasCapPerTx,
    rateLimitPerDay,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  budgets.set(merchantId, budget);
  return budget;
}

export function topUpBudget(merchantId: string, additionalWei: string): SponsorshipBudget {
  const budget = budgets.get(merchantId);
  if (!budget) throw new Error(`Budget for merchant ${merchantId} not found`);

  const total = BigInt(budget.totalDepositedWei) + BigInt(additionalWei);
  const available = BigInt(budget.availableWei) + BigInt(additionalWei);

  budget.totalDepositedWei = total.toString();
  budget.availableWei = available.toString();
  budget.active = true;
  budget.updatedAt = new Date().toISOString();
  return budget;
}

export function getBudget(merchantId: string): SponsorshipBudget | undefined {
  return budgets.get(merchantId);
}

export function listBudgets(): SponsorshipBudget[] {
  return Array.from(budgets.values());
}

export function updateBudgetPolicy(
  merchantId: string,
  updates: Partial<Pick<SponsorshipBudget, 'gasCapPerTx' | 'rateLimitPerDay' | 'active'>>
): SponsorshipBudget {
  const budget = budgets.get(merchantId);
  if (!budget) throw new Error(`Budget for merchant ${merchantId} not found`);
  Object.assign(budget, updates, { updatedAt: new Date().toISOString() });
  return budget;
}

// ---------------------------------------------------------------------------
// Budget verification (pre-flight check)
// ---------------------------------------------------------------------------

export function verifyBudget(
  merchantId: string,
  userWallet: string,
  gasUnits: number
): BudgetCheckResult {
  const budget = budgets.get(merchantId);

  if (!budget) {
    return { allowed: false, reason: 'budget_not_found' };
  }

  if (!budget.active) {
    return { allowed: false, reason: 'budget_exhausted' };
  }

  if (gasUnits > budget.gasCapPerTx) {
    return { allowed: false, reason: `gas_cap_exceeded:cap=${budget.gasCapPerTx}` };
  }

  // Check rate limit
  const usage = getOrCreateWalletUsage(merchantId, userWallet.toLowerCase());
  if (usage.count >= budget.rateLimitPerDay) {
    return {
      allowed: false,
      reason: 'rate_limit_exceeded',
      walletTxCountToday: usage.count,
    };
  }

  return {
    allowed: true,
    remainingBudgetWei: budget.availableWei,
    walletTxCountToday: usage.count,
  };
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export function recordGasSpend(
  merchantId: string,
  userWallet: string,
  gasUnits: number,
  gasCostWei: string,
  txHash?: string,
  chainId?: number
): SponsorshipTx {
  const budget = budgets.get(merchantId);
  if (!budget) throw new Error(`Budget for merchant ${merchantId} not found`);

  const spent = BigInt(budget.spentWei) + BigInt(gasCostWei);
  const available = BigInt(budget.totalDepositedWei) - spent;

  budget.spentWei = spent.toString();
  budget.availableWei = available > 0n ? available.toString() : '0';
  if (available <= 0n) budget.active = false;
  budget.updatedAt = new Date().toISOString();

  // Increment wallet daily usage
  const usage = getOrCreateWalletUsage(merchantId, userWallet.toLowerCase());
  usage.count++;

  const tx: SponsorshipTx = {
    id: randomUUID(),
    merchantId,
    userWallet: userWallet.toLowerCase(),
    gasUnits,
    gasCostWei,
    txHash,
    chainId,
    billedAt: new Date().toISOString(),
  };
  sponsorshipTxs.push(tx);
  return tx;
}

// ---------------------------------------------------------------------------
// Billing summary
// ---------------------------------------------------------------------------

export interface BillingSummary {
  merchantId: string;
  totalSpentWei: string;
  totalTxCount: number;
  availableWei: string;
  utilizationPct: number;
  periodTxs?: SponsorshipTx[];
}

export function getBillingSummary(
  merchantId: string,
  includeTxs = false
): BillingSummary {
  const budget = budgets.get(merchantId);
  if (!budget) throw new Error(`Budget for merchant ${merchantId} not found`);

  const txs = sponsorshipTxs.filter((t) => t.merchantId === merchantId);
  const deposited = BigInt(budget.totalDepositedWei);
  const spent = BigInt(budget.spentWei);
  const utilizationPct =
    deposited > 0n ? Number((spent * 100n) / deposited) : 0;

  return {
    merchantId,
    totalSpentWei: budget.spentWei,
    totalTxCount: txs.length,
    availableWei: budget.availableWei,
    utilizationPct,
    periodTxs: includeTxs ? txs : undefined,
  };
}

export function listSponsorshipTxs(merchantId?: string): SponsorshipTx[] {
  return merchantId
    ? sponsorshipTxs.filter((t) => t.merchantId === merchantId)
    : [...sponsorshipTxs];
}

// ---------------------------------------------------------------------------
// Wallet daily usage helpers
// ---------------------------------------------------------------------------

function getOrCreateWalletUsage(
  merchantId: string,
  wallet: string
): { count: number; windowStart: number } {
  if (!walletDailyUsage.has(merchantId)) {
    walletDailyUsage.set(merchantId, new Map());
  }
  const merchantMap = walletDailyUsage.get(merchantId)!;

  const now = Date.now();
  let entry = merchantMap.get(wallet);

  if (!entry || now - entry.windowStart > 86_400_000) {
    entry = { count: 0, windowStart: now };
    merchantMap.set(wallet, entry);
  }

  return entry;
}
