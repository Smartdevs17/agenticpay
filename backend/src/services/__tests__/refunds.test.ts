import { describe, it, expect, beforeEach } from 'vitest';
import {
  upsertRefundPolicy,
  getRefundPolicy,
  evaluateRefund,
  listManualReviews,
  resolveManualReview,
  getRefundAnalytics,
} from '../refunds.js';
import type { RefundEvaluationInput } from '../refunds.js';

describe('Refunds Service', () => {
  const merchantId = `merchant-${Date.now()}`;

  const mockInput = (overrides: Partial<RefundEvaluationInput> = {}): RefundEvaluationInput => ({
    merchantId,
    paymentId: `pay-${Date.now()}`,
    paymentType: 'card',
    amountPaid: 1000,
    requestedAmount: 100,
    daysSincePayment: 5,
    reason: 'Customer requested',
    hasChargeback: false,
    hasDispute: false,
    ...overrides,
  });

  // ── Policy Management ────────────────────────────────────────────────────

  describe('Policy Management', () => {
    it('creates and retrieves a refund policy', () => {
      const policy = upsertRefundPolicy({
        merchantId,
        fullRefundWindowDays: 14,
        autoApprovalThreshold: 50,
        alwaysRefundUnderAmount: 10,
        maxPartialRefundPercentage: 75,
        requireReason: false,
      });
      expect(policy.merchantId).toBe(merchantId);
      expect(policy.fullRefundWindowDays).toBe(14);
      expect(getRefundPolicy(merchantId).fullRefundWindowDays).toBe(14);
    });

    it('returns default policy when none set', () => {
      const policy = getRefundPolicy(`no-policy-${Date.now()}`);
      expect(policy.fullRefundWindowDays).toBe(30);
      expect(policy.autoApprovalThreshold).toBe(100);
      expect(policy.alwaysRefundUnderAmount).toBe(25);
    });

    it('updates existing policy', () => {
      upsertRefundPolicy({
        merchantId,
        fullRefundWindowDays: 30,
        autoApprovalThreshold: 100,
        alwaysRefundUnderAmount: 25,
        maxPartialRefundPercentage: 100,
        requireReason: true,
      });
      const updated = upsertRefundPolicy({
        merchantId,
        fullRefundWindowDays: 60,
        autoApprovalThreshold: 200,
        alwaysRefundUnderAmount: 50,
        maxPartialRefundPercentage: 80,
        requireReason: false,
      });
      expect(updated.fullRefundWindowDays).toBe(60);
      expect(updated.autoApprovalThreshold).toBe(200);
    });
  });

  // ── Refund Evaluation ────────────────────────────────────────────────────

  describe('evaluateRefund', () => {
    it('auto-approves refunds below always-refund threshold', () => {
      const result = evaluateRefund(mockInput({ requestedAmount: 20 }));
      expect(result.decision).toBe('approved');
      expect(result.amountApproved).toBe(20);
    });

    it('auto-approves within full refund window', () => {
      const result = evaluateRefund(mockInput({ requestedAmount: 500, daysSincePayment: 10 }));
      expect(result.decision).toBe('approved');
      expect(result.amountApproved).toBe(500);
    });

    it('rejects refunds exceeding partial refund percentage', () => {
      upsertRefundPolicy({
        merchantId,
        fullRefundWindowDays: 5,
        autoApprovalThreshold: 50,
        alwaysRefundUnderAmount: 10,
        maxPartialRefundPercentage: 50,
        requireReason: true,
      });
      const result = evaluateRefund(mockInput({
        requestedAmount: 800,
        daysSincePayment: 10,
      }));
      expect(result.decision).toBe('rejected');
      expect(result.amountApproved).toBe(0);
    });

    it('sends to manual review when chargeback exists', () => {
      const result = evaluateRefund(mockInput({
        requestedAmount: 20,
        hasChargeback: true,
      }));
      expect(result.decision).toBe('manual_review');
    });

    it('sends to manual review when dispute exists', () => {
      const result = evaluateRefund(mockInput({
        requestedAmount: 20,
        hasDispute: true,
      }));
      expect(result.decision).toBe('manual_review');
    });

    it('requires reason when policy demands it', () => {
      upsertRefundPolicy({
        merchantId,
        fullRefundWindowDays: 30,
        autoApprovalThreshold: 100,
        alwaysRefundUnderAmount: 25,
        maxPartialRefundPercentage: 100,
        requireReason: true,
      });
      expect(() => evaluateRefund(mockInput({ reason: undefined }))).toThrow();
    });

    it('allows empty reason when policy does not require it', () => {
      upsertRefundPolicy({
        merchantId,
        fullRefundWindowDays: 30,
        autoApprovalThreshold: 100,
        alwaysRefundUnderAmount: 25,
        maxPartialRefundPercentage: 100,
        requireReason: false,
      });
      expect(() => evaluateRefund(mockInput({ reason: undefined }))).not.toThrow();
    });

    it('auto-approves within auto-approval threshold', () => {
      upsertRefundPolicy({
        merchantId,
        fullRefundWindowDays: 5,
        autoApprovalThreshold: 50,
        alwaysRefundUnderAmount: 10,
        maxPartialRefundPercentage: 100,
        requireReason: true,
      });
      const result = evaluateRefund(mockInput({
        requestedAmount: 40,
        daysSincePayment: 10,
      }));
      expect(result.decision).toBe('approved');
    });

    it('sends to manual review for amounts above threshold', () => {
      upsertRefundPolicy({
        merchantId,
        fullRefundWindowDays: 5,
        autoApprovalThreshold: 50,
        alwaysRefundUnderAmount: 10,
        maxPartialRefundPercentage: 100,
        requireReason: true,
      });
      const result = evaluateRefund(mockInput({
        requestedAmount: 200,
        daysSincePayment: 10,
      }));
      expect(result.decision).toBe('manual_review');
    });
  });

  // ── Manual Review Queue ──────────────────────────────────────────────────

  describe('Manual Review Queue', () => {
    it('queues items for manual review', () => {
      upsertRefundPolicy({
        merchantId,
        fullRefundWindowDays: 5,
        autoApprovalThreshold: 50,
        alwaysRefundUnderAmount: 10,
        maxPartialRefundPercentage: 100,
        requireReason: true,
      });
      evaluateRefund(mockInput({ requestedAmount: 200, daysSincePayment: 10 }));
      const reviews = listManualReviews(merchantId);
      expect(reviews.length).toBeGreaterThanOrEqual(1);
      expect(reviews[0].status).toBe('pending');
    });

    it('resolves manual review item', () => {
      upsertRefundPolicy({
        merchantId,
        fullRefundWindowDays: 5,
        autoApprovalThreshold: 50,
        alwaysRefundUnderAmount: 10,
        maxPartialRefundPercentage: 100,
        requireReason: true,
      });
      evaluateRefund(mockInput({ requestedAmount: 200, daysSincePayment: 10 }));
      const reviews = listManualReviews(merchantId);
      const resolved = resolveManualReview(reviews[0].id, 'approved');
      expect(resolved.status).toBe('approved');
      expect(resolved.reviewedAt).toBeDefined();
    });
  });

  // ── Analytics ────────────────────────────────────────────────────────────

  describe('getRefundAnalytics', () => {
    it('returns analytics for merchant', () => {
      upsertRefundPolicy({
        merchantId,
        fullRefundWindowDays: 30,
        autoApprovalThreshold: 100,
        alwaysRefundUnderAmount: 25,
        maxPartialRefundPercentage: 100,
        requireReason: true,
      });
      evaluateRefund(mockInput({ requestedAmount: 20 }));
      evaluateRefund(mockInput({ requestedAmount: 200, daysSincePayment: 10 }));

      const analytics = getRefundAnalytics(merchantId);
      expect(analytics.merchantId).toBe(merchantId);
      expect(analytics.totalRequests).toBeGreaterThanOrEqual(2);
      expect(analytics.totalRequestedAmount).toBeGreaterThanOrEqual(220);
    });
  });
});
