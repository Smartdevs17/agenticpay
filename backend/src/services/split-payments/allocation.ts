/**
 * allocation.ts — Issue #917: Split payments between multiple recipients
 *
 * Pure, side-effect-free helpers that validate a split request and allocate a
 * payment down to the last minor unit. Shares are converted to integer basis
 * points and distributed with the largest-remainder (Hamilton) method, so:
 *
 *   platformFeeMinor + Σ share.amountMinor === totalMinor
 *
 * and no money is created or lost to rounding.
 */
import { err, ok, type Result } from '../../lib/result.js';
import type {
  CreateSplitPlanInput,
  NormalizedSplitPlan,
  SplitAllocation,
  SplitAllocationShare,
  SplitConfig,
  SplitRecipient,
  SplitRecipientInput,
} from './types.js';

export const DEFAULT_SPLIT_CONFIG: SplitConfig = {
  supportedCurrencies: ['USD', 'EUR', 'GBP', 'XLM', 'USDC'],
  defaultCurrency: 'USD',
  maxRecipients: 25,
};

const BPS_TOTAL = 10_000;

/** Round to 2 decimals using a half-up rule that tolerates float error. */
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Convert a percentage to integer basis points (1 bp = 0.01%). */
export function toBasisPoints(percentage: number): number {
  return Math.round(percentage * 100);
}

/** Convert basis points back to a percentage. */
export function fromBasisPoints(bps: number): number {
  return bps / 100;
}

/**
 * Largest-remainder allocation of `totalMinor` across `weights`.
 * The returned integers sum to exactly `totalMinor`.
 */
export function allocateMinorUnits(totalMinor: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalMinor <= 0 || totalWeight <= 0) {
    return weights.map(() => 0);
  }

  const exact = weights.map((weight) => (totalMinor * weight) / totalWeight);
  const minors = exact.map((value) => Math.floor(value));
  let remaining = totalMinor - minors.reduce((sum, value) => sum + value, 0);

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const entry of byRemainder) {
    if (remaining <= 0) break;
    minors[entry.index] += 1;
    remaining -= 1;
  }

  return minors;
}

/**
 * Validate recipient shares (plus the optional platform fee). The declared
 * percentages must sum to exactly 100 so the whole payment is allocated.
 */
export function validateSplitPlan(
  input: CreateSplitPlanInput,
  config: SplitConfig = DEFAULT_SPLIT_CONFIG,
): Result<NormalizedSplitPlan> {
  if (!input || typeof input !== 'object') {
    return err({ code: 'VALIDATION_ERROR', message: 'Split request body is required', statusCode: 400 });
  }
  if (!input.tenantId || typeof input.tenantId !== 'string') {
    return err({ code: 'VALIDATION_ERROR', message: 'tenantId is required', statusCode: 400 });
  }
  if (!Array.isArray(input.recipients) || input.recipients.length === 0) {
    return err({ code: 'VALIDATION_ERROR', message: 'At least one split recipient is required', statusCode: 400 });
  }
  if (input.recipients.length > config.maxRecipients) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `A split may have at most ${config.maxRecipients} recipients`,
      statusCode: 400,
    });
  }

  const currency = (input.currency ?? config.defaultCurrency).toUpperCase();
  if (!config.supportedCurrencies.includes(currency)) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `currency must be one of: ${config.supportedCurrencies.join(', ')}`,
      statusCode: 400,
    });
  }

  const platformFeePercentage = roundCurrency(input.platformFeePercentage ?? 0);
  if (!Number.isFinite(platformFeePercentage) || platformFeePercentage < 0 || platformFeePercentage > 100) {
    return err({
      code: 'VALIDATION_ERROR',
      message: 'platformFeePercentage must be between 0 and 100',
      statusCode: 400,
    });
  }

  const recipients: SplitRecipient[] = [];
  const seen = new Set<string>();

  for (const raw of input.recipients as SplitRecipientInput[]) {
    if (!raw.recipientId || typeof raw.recipientId !== 'string') {
      return err({ code: 'VALIDATION_ERROR', message: 'Each recipient requires a recipientId', statusCode: 400 });
    }
    if (seen.has(raw.recipientId)) {
      return err({
        code: 'VALIDATION_ERROR',
        message: `Duplicate recipientId "${raw.recipientId}"`,
        statusCode: 400,
      });
    }
    seen.add(raw.recipientId);

    if (!raw.walletAddress || typeof raw.walletAddress !== 'string') {
      return err({
        code: 'VALIDATION_ERROR',
        message: `Recipient "${raw.recipientId}" requires a walletAddress`,
        statusCode: 400,
      });
    }

    const percentage = roundCurrency(raw.percentage);
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
      return err({
        code: 'VALIDATION_ERROR',
        message: `Recipient "${raw.recipientId}" percentage must be greater than 0 and at most 100`,
        statusCode: 400,
      });
    }

    const minimumAmount = roundCurrency(raw.minimumAmount ?? 0);
    if (!Number.isFinite(minimumAmount) || minimumAmount < 0) {
      return err({
        code: 'VALIDATION_ERROR',
        message: `Recipient "${raw.recipientId}" minimumAmount must be a non-negative number`,
        statusCode: 400,
      });
    }

    recipients.push({
      recipientId: raw.recipientId,
      walletAddress: raw.walletAddress,
      percentage,
      shareBps: toBasisPoints(percentage),
      minimumAmount,
      label: raw.label ?? null,
    });
  }

  const platformFeeBps = toBasisPoints(platformFeePercentage);
  const recipientBps = recipients.reduce((sum, recipient) => sum + recipient.shareBps, 0);
  const totalBps = recipientBps + platformFeeBps;

  if (totalBps !== BPS_TOTAL) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `Recipient percentages plus platform fee must sum to exactly 100 (got ${fromBasisPoints(totalBps)})`,
      statusCode: 400,
    });
  }

  return ok({
    tenantId: input.tenantId,
    currency,
    platformFeePercentage,
    platformFeeBps,
    recipients,
    merchantId: input.merchantId,
    name: input.name,
    metadata: input.metadata,
  });
}

export interface AllocateSplitParams {
  totalAmount: number;
  platformFeePercentage: number;
  platformFeeBps: number;
  recipients: SplitRecipient[];
}

/**
 * Allocate a payment across the platform fee and recipients.
 * Assumes the recipients were normalised by `validateSplitPlan`.
 */
export function allocateSplit(params: AllocateSplitParams): SplitAllocation {
  const totalMinor = Math.round(params.totalAmount * 100);
  if (!Number.isFinite(totalMinor) || totalMinor <= 0) {
    throw new Error('totalAmount must be a positive number');
  }

  const weights = [params.platformFeeBps, ...params.recipients.map((recipient) => recipient.shareBps)];
  const minors = allocateMinorUnits(totalMinor, weights);
  const platformFeeMinor = minors[0] ?? 0;

  const shares: SplitAllocationShare[] = params.recipients.map((recipient, index) => {
    const amountMinor = minors[index + 1] ?? 0;
    const amount = roundCurrency(amountMinor / 100);
    const skipped = amount < recipient.minimumAmount;
    return {
      recipientId: recipient.recipientId,
      walletAddress: recipient.walletAddress,
      percentage: recipient.percentage,
      amount,
      amountMinor,
      skipped,
      reason: skipped ? 'Below minimum amount' : undefined,
    };
  });

  const allocatedMinor = platformFeeMinor + shares.reduce((sum, share) => sum + share.amountMinor, 0);

  return {
    totalAmount: roundCurrency(params.totalAmount),
    totalMinor,
    platformFeePercentage: params.platformFeePercentage,
    platformFeeBps: params.platformFeeBps,
    platformFeeAmount: roundCurrency(platformFeeMinor / 100),
    platformFeeMinor,
    shares,
    allocatedMinor,
    unallocatedMinor: totalMinor - allocatedMinor,
  };
}
