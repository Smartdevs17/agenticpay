import { randomUUID } from 'node:crypto';

/**
 * Merchant onboarding with risk tiering (Issue #928).
 *
 * Assigns each merchant a risk tier during onboarding based on a deterministic
 * scoring model over business, financial, and compliance signals. The tier
 * drives the merchant's transaction limits, payout hold period, and required
 * onboarding checks. All state is held in memory (matching the existing
 * in-memory onboarding service) so the module is pure, testable, and has no
 * external dependencies.
 */

export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface MerchantRiskSignals {
  /** Business structural signals */
  businessAgeMonths: number;
  /** Financial signals */
  monthlyVolumeUsd: number;
  chargebacks90d: number;
  refundRatePct: number;
  /** Compliance signals */
  sanctionsHits: number;
  kycVerified: boolean;
  kybVerified: boolean;
  /** Optional jurisdiction risk multiplier, 0..1 */
  jurisdictionRisk?: number;
}

export interface RiskTierPolicy {
  tier: RiskTier;
  /** Maximum single transaction amount in USD, null = unlimited */
  maxTransactionUsd: number | null;
  /** Maximum rolling daily volume in USD, null = unlimited */
  dailyVolumeLimitUsd: number | null;
  /** Payout hold period in days */
  payoutHoldDays: number;
  /** Whether manual review is required before payouts release */
  manualReview: boolean;
  /** Additional onboarding checks required at this tier */
  requiredChecks: string[];
}

export interface RiskAssessment {
  id: string;
  merchantId: string;
  tier: RiskTier;
  score: number;
  factors: string[];
  policy: RiskTierPolicy;
  createdAt: string;
}

const TIER_POLICIES: Record<RiskTier, RiskTierPolicy> = {
  low: {
    tier: 'low',
    maxTransactionUsd: 50_000,
    dailyVolumeLimitUsd: 250_000,
    payoutHoldDays: 2,
    manualReview: false,
    requiredChecks: ['business_info', 'business_license', 'identity_verification'],
  },
  medium: {
    tier: 'medium',
    maxTransactionUsd: 20_000,
    dailyVolumeLimitUsd: 75_000,
    payoutHoldDays: 5,
    manualReview: false,
    requiredChecks: ['business_info', 'business_license', 'identity_verification', 'bank_verification'],
  },
  high: {
    tier: 'high',
    maxTransactionUsd: 5_000,
    dailyVolumeLimitUsd: 20_000,
    payoutHoldDays: 14,
    manualReview: true,
    requiredChecks: [
      'business_info',
      'business_license',
      'identity_verification',
      'bank_verification',
      'tax_id',
      'compliance_check',
    ],
  },
  critical: {
    tier: 'critical',
    maxTransactionUsd: 1_000,
    dailyVolumeLimitUsd: 5_000,
    payoutHoldDays: 30,
    manualReview: true,
    requiredChecks: [
      'business_info',
      'business_license',
      'identity_verification',
      'bank_verification',
      'tax_id',
      'compliance_check',
      'enhanced_due_diligence',
    ],
  },
};

const assessments = new Map<string, RiskAssessment>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Compute a 0..100 merchant risk score from onboarding signals. Higher is
 * riskier. Each factor contributes a bounded number of points so a single
 * extreme signal cannot unilaterally saturate the score.
 */
export function scoreMerchantRisk(signals: MerchantRiskSignals): {
  score: number;
  factors: string[];
} {
  let score = 0;
  const factors: string[] = [];

  // Newer businesses are riskier (up to 20 points).
  const agePoints = clamp((12 - signals.businessAgeMonths) * (20 / 12), 0, 20);
  if (agePoints > 0) {
    score += agePoints;
    factors.push(`business_age:${agePoints.toFixed(1)}`);
  }

  // Chargeback history (up to 25 points).
  const chargebackPoints = clamp(signals.chargebacks90d * 5, 0, 25);
  if (chargebackPoints > 0) {
    score += chargebackPoints;
    factors.push(`chargebacks:${chargebackPoints.toFixed(1)}`);
  }

  // Refund rate above 5% is penalised (up to 15 points).
  const refundPoints = clamp((signals.refundRatePct - 5) * 1.5, 0, 15);
  if (refundPoints > 0) {
    score += refundPoints;
    factors.push(`refund_rate:${refundPoints.toFixed(1)}`);
  }

  // High expected volume (up to 15 points).
  const volumePoints = clamp(signals.monthlyVolumeUsd / 100_000 * 15, 0, 15);
  if (volumePoints > 0) {
    score += volumePoints;
    factors.push(`volume:${volumePoints.toFixed(1)}`);
  }

  // Compliance gaps (up to 54 points).
  if (!signals.kycVerified) {
    score += 12;
    factors.push('kyc_missing:12.0');
  }
  if (!signals.kybVerified) {
    score += 12;
    factors.push('kyb_missing:12.0');
  }
  if (signals.sanctionsHits > 0) {
    score += 30;
    factors.push('sanctions_hits:30.0');
  }

  // Jurisdiction risk multiplier (up to 10 points).
  const jurisdictionPoints = clamp((signals.jurisdictionRisk ?? 0) * 10, 0, 10);
  if (jurisdictionPoints > 0) {
    score += jurisdictionPoints;
    factors.push(`jurisdiction:${jurisdictionPoints.toFixed(1)}`);
  }

  return { score: Number(clamp(score, 0, 100).toFixed(2)), factors };
}

export function tierForScore(score: number): RiskTier {
  if (score >= 65) return 'critical';
  if (score >= 40) return 'high';
  if (score >= 18) return 'medium';
  return 'low';
}

export function getPolicyForTier(tier: RiskTier): RiskTierPolicy {
  // Return a defensive copy so callers cannot mutate the shared policy table.
  return { ...TIER_POLICIES[tier], requiredChecks: [...TIER_POLICIES[tier].requiredChecks] };
}

export function assessMerchant(
  merchantId: string,
  signals: MerchantRiskSignals,
): RiskAssessment {
  const { score, factors } = scoreMerchantRisk(signals);
  const tier = tierForScore(score);

  const assessment: RiskAssessment = {
    id: `risk_${randomUUID()}`,
    merchantId,
    tier,
    score,
    factors,
    policy: getPolicyForTier(tier),
    createdAt: new Date().toISOString(),
  };

  assessments.set(merchantId, assessment);
  return assessment;
}

/**
 * Re-score an existing merchant (e.g. periodic review) preserving the same
 * merchant id so downstream lookups stay valid.
 */
export function reassessMerchant(
  merchantId: string,
  signals: MerchantRiskSignals,
): RiskAssessment {
  return assessMerchant(merchantId, signals);
}

export function getAssessment(merchantId: string): RiskAssessment | null {
  const existing = assessments.get(merchantId);
  if (!existing) return null;
  return { ...existing, policy: getPolicyForTier(existing.tier), factors: [...existing.factors] };
}

export function listAssessments(tier?: RiskTier): RiskAssessment[] {
  const all = Array.from(assessments.values()).map((a) => ({
    ...a,
    policy: getPolicyForTier(a.tier),
    factors: [...a.factors],
  }));
  return tier ? all.filter((a) => a.tier === tier) : all;
}

/**
 * Evaluate whether a proposed transaction is permitted under the merchant's
 * current tier policy. Returns the effective limit and a reason when blocked.
 */
export function evaluateTransactionLimit(
  merchantId: string,
  amountUsd: number,
): { allowed: boolean; limitUsd: number | null; reason?: string } {
  const assessment = assessments.get(merchantId);
  if (!assessment) {
    return { allowed: false, limitUsd: null, reason: 'merchant_not_assessed' };
  }

  const limit = assessment.policy.maxTransactionUsd;
  if (limit !== null && amountUsd > limit) {
    return {
      allowed: false,
      limitUsd: limit,
      reason: `amount_exceeds_${assessment.tier}_tier_limit`,
    };
  }
  return { allowed: true, limitUsd: limit };
}

/** Test helper: clear all in-memory assessments. */
export function resetRiskAssessmentsForTests(): void {
  assessments.clear();
}
