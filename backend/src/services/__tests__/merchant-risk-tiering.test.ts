import { describe, expect, it, beforeEach } from 'vitest';
import {
  assessMerchant,
  reassessMerchant,
  getAssessment,
  listAssessments,
  getPolicyForTier,
  evaluateTransactionLimit,
  scoreMerchantRisk,
  tierForScore,
  resetRiskAssessmentsForTests,
  MerchantRiskSignals,
} from '../merchant-risk-tiering.js';

const cleanSignals: MerchantRiskSignals = {
  businessAgeMonths: 60,
  monthlyVolumeUsd: 10_000,
  chargebacks90d: 0,
  refundRatePct: 1,
  sanctionsHits: 0,
  kycVerified: true,
  kybVerified: true,
  jurisdictionRisk: 0,
};

describe('merchant-risk-tiering', () => {
  beforeEach(() => {
    resetRiskAssessmentsForTests();
  });

  it('assigns a low tier to a well-established verified merchant', () => {
    const result = scoreMerchantRisk(cleanSignals);
    expect(result.score).toBeLessThan(20);
    expect(tierForScore(result.score)).toBe('low');
  });

  it('escalates to critical when sanctions hits and compliance gaps combine', () => {
    const result = scoreMerchantRisk({
      ...cleanSignals,
      businessAgeMonths: 0,
      sanctionsHits: 1,
      kycVerified: false,
      kybVerified: false,
    });
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(tierForScore(result.score)).toBe('critical');
  });

  it('caps the score at 100', () => {
    const result = scoreMerchantRisk({
      businessAgeMonths: 0,
      monthlyVolumeUsd: 10_000_000,
      chargebacks90d: 20,
      refundRatePct: 100,
      sanctionsHits: 5,
      kycVerified: false,
      kybVerified: false,
      jurisdictionRisk: 1,
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('records factors that explain the score', () => {
    const result = scoreMerchantRisk({ ...cleanSignals, chargebacks90d: 2 });
    expect(result.factors.some((f) => f.startsWith('chargebacks'))).toBe(true);
  });

  it('assesses and persists a merchant', () => {
    const assessment = assessMerchant('m-1', cleanSignals);
    expect(assessment.merchantId).toBe('m-1');
    expect(assessment.id).toMatch(/^risk_/);
    expect(assessment.policy.tier).toBe(assessment.tier);
    expect(getAssessment('m-1')?.tier).toBe(assessment.tier);
  });

  it('returns null for an unknown merchant', () => {
    expect(getAssessment('missing')).toBeNull();
  });

  it('reassesses a merchant in place', () => {
    assessMerchant('m-2', cleanSignals);
    const updated = reassessMerchant('m-2', {
      ...cleanSignals,
      businessAgeMonths: 0,
      kycVerified: false,
      kybVerified: false,
    });
    expect(updated.merchantId).toBe('m-2');
    expect(getAssessment('m-2')?.score).toBe(updated.score);
    expect(listAssessments()).toHaveLength(1);
  });

  it('filters assessments by tier', () => {
    assessMerchant('low-1', cleanSignals);
    assessMerchant('critical-1', {
      ...cleanSignals,
      businessAgeMonths: 0,
      sanctionsHits: 2,
      kycVerified: false,
      kybVerified: false,
    });
    expect(listAssessments('low').map((a) => a.merchantId)).toEqual(['low-1']);
    expect(listAssessments('critical')).toHaveLength(1);
  });

  it('exposes tier policies with transaction limits', () => {
    const low = getPolicyForTier('low');
    const critical = getPolicyForTier('critical');
    expect(low.maxTransactionUsd).toBeGreaterThan(critical.maxTransactionUsd ?? 0);
    expect(critical.requiredChecks).toContain('enhanced_due_diligence');
  });

  it('does not allow mutation of the shared policy table', () => {
    const policy = getPolicyForTier('low');
    policy.requiredChecks.push('tampered');
    expect(getPolicyForTier('low').requiredChecks).not.toContain('tampered');
  });

  it('allows transactions within the tier limit', () => {
    assessMerchant('m-3', cleanSignals);
    const result = evaluateTransactionLimit('m-3', 1_000);
    expect(result.allowed).toBe(true);
  });

  it('blocks transactions that exceed the tier limit', () => {
    const assessment = assessMerchant('m-4', {
      ...cleanSignals,
      sanctionsHits: 1,
      kycVerified: false,
      kybVerified: false,
    });
    const overLimit = (assessment.policy.maxTransactionUsd ?? 0) + 1;
    const result = evaluateTransactionLimit('m-4', overLimit);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain(assessment.tier);
  });

  it('blocks evaluation for an unassessed merchant', () => {
    const result = evaluateTransactionLimit('ghost', 100);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('merchant_not_assessed');
  });
});
