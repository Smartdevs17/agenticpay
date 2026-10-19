/**
 * types.ts — Issue #917: Split payments between multiple recipients
 *
 * Domain types for splitting a single payment across a platform fee and one or
 * more recipients. Shares are declared as percentages but normalised to
 * integer basis points (`shareBps`) so allocation is exact down to the minor
 * unit and never drifts through floating point.
 */

export type SplitPlanStatus = 'active' | 'archived';

/** Recipient as supplied by the caller. */
export interface SplitRecipientInput {
  recipientId: string;
  walletAddress: string;
  /** Share of the payment as a percentage in (0, 100]. */
  percentage: number;
  /** Allocations below this amount (major units) are marked `skipped`. */
  minimumAmount?: number;
  label?: string;
}

/** Recipient after normalisation into basis points. */
export interface SplitRecipient {
  recipientId: string;
  walletAddress: string;
  percentage: number;
  /** Integer share in basis points (1 bp = 0.01%). */
  shareBps: number;
  minimumAmount: number;
  label?: string | null;
}

export interface SplitPlan {
  id: string;
  tenantId: string;
  merchantId?: string | null;
  name?: string | null;
  currency: string;
  platformFeePercentage: number;
  platformFeeBps: number;
  recipients: SplitRecipient[];
  status: SplitPlanStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSplitPlanInput {
  tenantId: string;
  recipients: SplitRecipientInput[];
  platformFeePercentage?: number;
  currency?: string;
  merchantId?: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface SplitPlanFilter {
  status?: SplitPlanStatus;
  merchantId?: string;
}

/** One recipient's (or the platform fee's) slice of an executed payment. */
export interface SplitAllocationShare {
  recipientId: string;
  walletAddress: string;
  percentage: number;
  /** Exact amount, in major currency units. */
  amount: number;
  /** Exact amount, in integer minor units (e.g. cents). */
  amountMinor: number;
  skipped: boolean;
  reason?: string;
}

export interface SplitAllocation {
  totalAmount: number;
  totalMinor: number;
  platformFeePercentage: number;
  platformFeeBps: number;
  platformFeeAmount: number;
  platformFeeMinor: number;
  shares: SplitAllocationShare[];
  /** `platformFeeMinor` plus every share's `amountMinor`. */
  allocatedMinor: number;
  /** Always 0 for a validated split; exposed for observability. */
  unallocatedMinor: number;
}

export interface SplitExecution {
  id: string;
  planId: string;
  tenantId: string;
  paymentId: string;
  totalAmount: number;
  currency: string;
  platformFeeAmount: number;
  distributions: SplitAllocationShare[];
  allocatedMinor: number;
  executedAt: string;
}

export interface SplitExecutionSummary {
  planId: string;
  executionCount: number;
  totalProcessed: number;
  totalPlatformFees: number;
  skippedDistributions: number;
}

export interface SplitConfig {
  supportedCurrencies: string[];
  defaultCurrency: string;
  maxRecipients: number;
}

export interface NormalizedSplitPlan {
  tenantId: string;
  currency: string;
  platformFeePercentage: number;
  platformFeeBps: number;
  recipients: SplitRecipient[];
  merchantId?: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

export type SplitEventType =
  | 'split_plan.created'
  | 'split_plan.archived'
  | 'split.executed';

export interface SplitEvent {
  type: SplitEventType;
  planId: string;
  tenantId: string;
  occurredAt: string;
  data?: Record<string, unknown>;
}

/** Pluggable publisher so the service stays transport-agnostic. */
export interface SplitEventPublisher {
  publish(event: SplitEvent): Promise<void> | void;
}
