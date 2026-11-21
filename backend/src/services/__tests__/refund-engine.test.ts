import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetForTests,
  upsertRefundPolicy,
  getRefundPolicy,
  listRefundPolicies,
  deleteRefundPolicy,
  evaluateRefund,
  approveRefund,
  rejectRefund,
  processRefund,
  autoProcessApprovedRefunds,
  retryFailedRefund,
  cancelRefund,
  getRefund,
  listRefunds,
  getRefundHistory,
  getRefundAnalytics,
  getRefundMetricsSummary,
} from '../refund-engine.js';
import type { RefundEvaluationInput, RefundPolicy } from '../refund-engine.js';

const mockInput = (overrides: Partial<RefundEvaluationInput> = {}): RefundEvaluationInput => ({
  workspaceId: 'ws-1',
  paymentId: 'pay-1',
  paymentType: 'card',
  amountPaid: 1000,
  requestedAmount: 100,
  currency: 'USD',
  daysSincePayment: 5,
  reason: 'Customer requested refund',
  hasChargeback: false,
  hasDispute: false,
  ...overrides,
});

describe('RefundEngine', () => {
  beforeEach(() => {
    resetForTests();
  });

  // ── Policy Management ────────────────────────────────────────────────────

  describe('Policy Management', () => {
    it('creates a default policy when none exists', () => {
      const policy = getRefundPolicy('ws-1');
      expect(policy.workspaceId).toBe('ws-1');
      expect(policy.name).toBe('default');
      expect(policy.fullRefundWindowDays).toBe(30);
      expect(policy.autoApprovalThreshold).toBe(100);
      expect(policy.alwaysRefundUnderAmount).toBe(25);
      expect(policy.isActive).toBe(true);
    });

    it('creates and retrieves a policy', () => {
      const policy = upsertRefundPolicy({
        workspaceId: 'ws-1',
        name: 'standard',
        fullRefundWindowDays: 14,
        autoApprovalThreshold: 200,
        alwaysRefundUnderAmount: 50,
        maxPartialRefundPct: 80,
        requireReason: true,
        firstApprovalThreshold: 1000,
        secondApprovalThreshold: 10000,
        rules: [],
        isActive: true,
      });

      expect(policy.name).toBe('standard');
      expect(policy.fullRefundWindowDays).toBe(14);

      const retrieved = getRefundPolicy('ws-1', 'standard');
      expect(retrieved?.name).toBe('standard');
    });

    it('lists policies for a workspace', () => {
      upsertRefundPolicy({ workspaceId: 'ws-1', name: 'policy-a', fullRefundWindowDays: 30, autoApprovalThreshold: 100, alwaysRefundUnderAmount: 25, maxPartialRefundPct: 100, requireReason: true, firstApprovalThreshold: 500, secondApprovalThreshold: 5000, rules: [], isActive: true });
      upsertRefundPolicy({ workspaceId: 'ws-1', name: 'policy-b', fullRefundWindowDays: 30, autoApprovalThreshold: 100, alwaysRefundUnderAmount: 25, maxPartialRefundPct: 100, requireReason: true, firstApprovalThreshold: 500, secondApprovalThreshold: 5000, rules: [], isActive: true });

      const policies = listRefundPolicies('ws-1');
      expect(policies).toHaveLength(2);
    });

    it('deactivates a policy on delete', () => {
      const policy = upsertRefundPolicy({ workspaceId: 'ws-1', name: 'test', fullRefundWindowDays: 30, autoApprovalThreshold: 100, alwaysRefundUnderAmount: 25, maxPartialRefundPct: 100, requireReason: true, firstApprovalThreshold: 500, secondApprovalThreshold: 5000, rules: [], isActive: true });
      expect(deleteRefundPolicy(policy.id)).toBe(true);

      // Deleted policy is deactivated, so getRefundPolicy returns default
      const retrieved = getRefundPolicy('ws-1', 'test');
      expect(retrieved.isActive).toBe(true);
      expect(retrieved.name).toBe('default');
    });
  });

  // ── Refund Evaluation ────────────────────────────────────────────────────

  describe('Refund Evaluation', () => {
    it('approves refund under always-refund threshold', () => {
      const result = evaluateRefund(mockInput({ requestedAmount: 20 }));
      expect(result.decision).toBe('approved');
      expect(result.amountApproved).toBe(20);
    });

    it('approves refund within full refund window', () => {
      const result = evaluateRefund(mockInput({ requestedAmount: 200, daysSincePayment: 10 }));
      expect(result.decision).toBe('approved');
    });

    it('rejects refund exceeding partial refund limit', () => {
      upsertRefundPolicy({ workspaceId: 'ws-1', name: 'strict', fullRefundWindowDays: 30, autoApprovalThreshold: 100, alwaysRefundUnderAmount: 25, maxPartialRefundPct: 50, requireReason: true, firstApprovalThreshold: 500, secondApprovalThreshold: 5000, rules: [], isActive: true });
      const result = evaluateRefund(mockInput({ requestedAmount: 600, daysSincePayment: 60 }));
      expect(result.decision).toBe('rejected');
    });

    it('manual review for chargeback', () => {
      const result = evaluateRefund(mockInput({ hasChargeback: true }));
      expect(result.decision).toBe('manual_review');
      expect(result.requiredApprovalLevel).toBe('first');
    });

    it('manual review for dispute', () => {
      const result = evaluateRefund(mockInput({ hasDispute: true }));
      expect(result.decision).toBe('manual_review');
    });

    it('requires reason when policy requires it', () => {
      expect(() => evaluateRefund(mockInput({ reason: '' }))).toThrow('Refund reason is required');
    });

    it('first-level approval for large amounts', () => {
      const result = evaluateRefund(mockInput({ requestedAmount: 300, daysSincePayment: 60 }));
      expect(result.decision).toBe('manual_review');
      expect(result.requiredApprovalLevel).toBe('first');
    });

    it('second-level approval for larger amounts', () => {
      const result = evaluateRefund(mockInput({ amountPaid: 10000, requestedAmount: 2000, daysSincePayment: 60 }));
      expect(result.decision).toBe('manual_review');
      expect(result.requiredApprovalLevel).toBe('second');
    });

    it('third-level approval for very large amounts', () => {
      const result = evaluateRefund(mockInput({ amountPaid: 50000, requestedAmount: 10000, daysSincePayment: 60 }));
      expect(result.decision).toBe('manual_review');
      expect(result.requiredApprovalLevel).toBe('third');
    });
  });

  // ── Custom Policy Rules ──────────────────────────────────────────────────

  describe('Custom Policy Rules', () => {
    it('evaluates custom rules with higher priority', () => {
      upsertRefundPolicy({
        workspaceId: 'ws-1',
        name: 'custom',
        fullRefundWindowDays: 30,
        autoApprovalThreshold: 100,
        alwaysRefundUnderAmount: 25,
        maxPartialRefundPct: 100,
        requireReason: true,
        firstApprovalThreshold: 500,
        secondApprovalThreshold: 5000,
        rules: [
          { id: 'r1', field: 'customer_tier', operator: 'eq', value: 'enterprise', outcome: 'approve', priority: 100 },
        ],
        isActive: true,
      });

      const result = evaluateRefund(mockInput({ customerTier: 'enterprise', requestedAmount: 5000 }));
      expect(result.decision).toBe('approved');
    });

    it('rejects based on previous refund count', () => {
      upsertRefundPolicy({
        workspaceId: 'ws-1',
        name: 'abuse-prevention',
        fullRefundWindowDays: 30,
        autoApprovalThreshold: 100,
        alwaysRefundUnderAmount: 25,
        maxPartialRefundPct: 100,
        requireReason: true,
        firstApprovalThreshold: 500,
        secondApprovalThreshold: 5000,
        rules: [
          { id: 'r1', field: 'previous_refund_count', operator: 'gte', value: 3, outcome: 'manual_review', priority: 100 },
        ],
        isActive: true,
      });

      const result = evaluateRefund(mockInput({ previousRefundCount: 5 }));
      expect(result.decision).toBe('manual_review');
    });

    it('matches rules using "in" operator', () => {
      upsertRefundPolicy({
        workspaceId: 'ws-1',
        name: 'payment-type-filter',
        fullRefundWindowDays: 30,
        autoApprovalThreshold: 100,
        alwaysRefundUnderAmount: 25,
        maxPartialRefundPct: 100,
        requireReason: true,
        firstApprovalThreshold: 500,
        secondApprovalThreshold: 5000,
        rules: [
          { id: 'r1', field: 'payment_type', operator: 'in', value: ['crypto', 'bank_transfer'], outcome: 'manual_review', priority: 100 },
        ],
        isActive: true,
      });

      const result = evaluateRefund(mockInput({ paymentType: 'crypto' }));
      expect(result.decision).toBe('manual_review');
    });

    it('passes through to built-in rules when no custom rules match', () => {
      upsertRefundPolicy({
        workspaceId: 'ws-1',
        name: 'with-rules',
        fullRefundWindowDays: 30,
        autoApprovalThreshold: 100,
        alwaysRefundUnderAmount: 25,
        maxPartialRefundPct: 100,
        requireReason: true,
        firstApprovalThreshold: 500,
        secondApprovalThreshold: 5000,
        rules: [
          { id: 'r1', field: 'customer_tier', operator: 'eq', value: 'enterprise', outcome: 'approve', priority: 100 },
        ],
        isActive: true,
      });

      // basic tier, small amount -> built-in rule: always-refund threshold
      const result = evaluateRefund(mockInput({ customerTier: 'basic', requestedAmount: 20 }));
      expect(result.decision).toBe('approved');
    });

    it('returns matched rule in result', () => {
      upsertRefundPolicy({
        workspaceId: 'ws-1',
        name: 'with-rules',
        fullRefundWindowDays: 30,
        autoApprovalThreshold: 100,
        alwaysRefundUnderAmount: 25,
        maxPartialRefundPct: 100,
        requireReason: true,
        firstApprovalThreshold: 500,
        secondApprovalThreshold: 5000,
        rules: [
          { id: 'r1', field: 'customer_tier', operator: 'eq', value: 'premium', outcome: 'approve', priority: 100 },
        ],
        isActive: true,
      });

      const result = evaluateRefund(mockInput({ customerTier: 'premium', requestedAmount: 5000 }));
      expect(result.matchedRule).toBeDefined();
      expect(result.matchedRule!.id).toBe('r1');
    });
  });

  // ── Approval Workflow ────────────────────────────────────────────────────

  describe('Approval Workflow', () => {
    it('approves a refund at the required level', () => {
      const evalResult = evaluateRefund(mockInput({ requestedAmount: 300, daysSincePayment: 60 }));
      expect(evalResult.decision).toBe('manual_review');
      expect(evalResult.requiredApprovalLevel).toBe('first');

      const refund = getRefundByPaymentId('ws-1', 'pay-1');
      expect(refund).toBeDefined();

      if (refund) {
        const approved = approveRefund(refund.id, 'approver-1', 'first');
        expect(approved.status).toBe('approved');
        expect(approved.decision).toBe('approved');
        expect(approved.approvedBy).toBe('approver-1');
      }
    });

    it('rejects a refund', () => {
      const evalResult = evaluateRefund(mockInput({ requestedAmount: 300, daysSincePayment: 60 }));
      const refund = getRefundByPaymentId('ws-1', 'pay-1');

      if (refund) {
        const rejected = rejectRefund(refund.id, 'approver-1', 'first', 'Not eligible');
        expect(rejected.status).toBe('rejected');
      }
    });

    it('tracks approval history', () => {
      const evalResult = evaluateRefund(mockInput({ requestedAmount: 300, daysSincePayment: 60 }));
      const refund = getRefundByPaymentId('ws-1', 'pay-1');

      if (refund) {
        approveRefund(refund.id, 'approver-1', 'first');
        const history = getRefundHistory(refund.id);
        expect(history.length).toBeGreaterThanOrEqual(2);
        expect(history[0].action).toBe('pending_review');
        expect(history[history.length - 1].action).toBe('approved');
      }
    });
  });

  // ── Processing ───────────────────────────────────────────────────────────

  describe('Processing', () => {
    it('processes an approved refund', async () => {
      const evalResult = evaluateRefund(mockInput({ requestedAmount: 20 }));
      expect(evalResult.decision).toBe('approved');

      const refund = getRefundByPaymentId('ws-1', 'pay-1');
      expect(refund).toBeDefined();

      if (refund) {
        const processed = await processRefund(refund.id);
        expect(processed.status).toBe('completed');
        expect(processed.completedAt).toBeDefined();
      }
    });

    it('fails if refund is not approved', async () => {
      const evalResult = evaluateRefund(mockInput({ requestedAmount: 300, daysSincePayment: 60 }));
      const refund = getRefundByPaymentId('ws-1', 'pay-1');

      if (refund) {
        await expect(processRefund(refund.id)).rejects.toThrow('Refund must be approved');
      }
    });

    it('uses custom provider function', async () => {
      evaluateRefund(mockInput({ requestedAmount: 20 }));
      const refund = getRefundByPaymentId('ws-1', 'pay-1');

      if (refund) {
        const processed = await processRefund(refund.id, async () => ({
          success: true,
          txHash: 'tx_mock_refund_123',
        }));
        expect(processed.status).toBe('completed');
        expect(processed.stripeRefundId).toBe('tx_mock_refund_123');
      }
    });

    it('handles provider failure', async () => {
      evaluateRefund(mockInput({ requestedAmount: 20 }));
      const refund = getRefundByPaymentId('ws-1', 'pay-1');

      if (refund) {
        const processed = await processRefund(refund.id, async () => ({
          success: false,
          error: 'Insufficient funds',
        }));
        expect(processed.status).toBe('failed');
        expect(processed.failureReason).toBe('Insufficient funds');
      }
    });
  });

  // ── Auto-Process ─────────────────────────────────────────────────────────

  describe('Auto-Process', () => {
    it('auto-processes all approved refunds', async () => {
      evaluateRefund(mockInput({ paymentId: 'pay-1', requestedAmount: 20 }));
      evaluateRefund(mockInput({ paymentId: 'pay-2', requestedAmount: 15 }));

      const result = await autoProcessApprovedRefunds();
      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('skips non-approved refunds', async () => {
      evaluateRefund(mockInput({ paymentId: 'pay-1', requestedAmount: 20 }));
      evaluateRefund(mockInput({ paymentId: 'pay-2', requestedAmount: 300, daysSincePayment: 60 }));

      const result = await autoProcessApprovedRefunds();
      expect(result.processed).toBe(1);
      expect(result.failed).toBe(0);
    });
  });

  // ── Retry ────────────────────────────────────────────────────────────────

  describe('Retry', () => {
    it('retries a failed refund', async () => {
      evaluateRefund(mockInput({ requestedAmount: 20 }));
      const refund = getRefundByPaymentId('ws-1', 'pay-1');

      if (refund) {
        // Force fail
        await processRefund(refund.id, async () => ({
          success: false,
          error: 'Network error',
        }));
        expect(refund.status).toBe('failed');

        // Retry
        const retried = await retryFailedRefund(refund.id, async () => ({
          success: true,
          txHash: 'tx_retry_123',
        }));
        expect(retried.status).toBe('completed');
      }
    });
  });

  // ── Cancel ───────────────────────────────────────────────────────────────

  describe('Cancel', () => {
    it('cancels a pending refund', () => {
      evaluateRefund(mockInput({ requestedAmount: 300, daysSincePayment: 60 }));
      const refund = getRefundByPaymentId('ws-1', 'pay-1');

      if (refund) {
        const cancelled = cancelRefund(refund.id, 'admin-1', 'No longer needed');
        expect(cancelled.status).toBe('cancelled');
        expect(cancelled.cancelledAt).toBeDefined();
      }
    });

    it('cannot cancel a completed refund', async () => {
      evaluateRefund(mockInput({ requestedAmount: 20 }));
      const refund = getRefundByPaymentId('ws-1', 'pay-1');

      if (refund) {
        await processRefund(refund.id);
        expect(() => cancelRefund(refund.id, 'admin-1')).toThrow('already');
      }
    });
  });

  // ── Query ────────────────────────────────────────────────────────────────

  describe('Query', () => {
    it('lists refunds with filters', () => {
      evaluateRefund(mockInput({ paymentId: 'pay-1', requestedAmount: 20 }));
      evaluateRefund(mockInput({ paymentId: 'pay-2', requestedAmount: 300, daysSincePayment: 60 }));

      const all = listRefunds('ws-1');
      expect(all.total).toBe(2);

      const pending = listRefunds('ws-1', { status: 'pending' });
      expect(pending.total).toBe(1);

      const approved = listRefunds('ws-1', { status: 'approved' });
      expect(approved.total).toBe(1);
    });

    it('returns refund history', () => {
      evaluateRefund(mockInput({ paymentId: 'pay-1', requestedAmount: 300, daysSincePayment: 60 }));
      const refund = getRefundByPaymentId('ws-1', 'pay-1');

      if (refund) {
        const history = getRefundHistory(refund.id);
        expect(history.length).toBeGreaterThan(0);
        expect(history[0].action).toBe('pending_review');
      }
    });
  });

  // ── Analytics ────────────────────────────────────────────────────────────

  describe('Analytics', () => {
    it('returns analytics for a workspace', () => {
      evaluateRefund(mockInput({ paymentId: 'pay-1', requestedAmount: 20 }));
      evaluateRefund(mockInput({ paymentId: 'pay-2', requestedAmount: 300, daysSincePayment: 60 }));
      evaluateRefund(mockInput({ paymentId: 'pay-3', requestedAmount: 100, daysSincePayment: 35, hasChargeback: true }));

      const analytics = getRefundAnalytics({ workspaceId: 'ws-1' });
      expect(analytics.totalRequests).toBe(3);
      expect(analytics.totalApproved).toBe(1);
      expect(analytics.totalManualReview).toBe(2);
      expect(analytics.approvalRate).toBeCloseTo(1 / 3, 2);
    });

    it('filters analytics by date range', () => {
      evaluateRefund(mockInput({ paymentId: 'pay-1', requestedAmount: 20 }));
      const analytics = getRefundAnalytics({ workspaceId: 'ws-1', fromDate: '2099-01-01' });
      expect(analytics.totalRequests).toBe(0);
    });
  });

  // ── Metrics Summary ──────────────────────────────────────────────────────

  describe('Metrics Summary', () => {
    it('returns global metrics summary', () => {
      evaluateRefund(mockInput({ paymentId: 'pay-1', requestedAmount: 20 }));
      const summary = getRefundMetricsSummary();
      expect(summary.totalRefunds).toBe(1);
    });
  });
});

// Helper to find refund by paymentId in store
function getRefundByPaymentId(workspaceId: string, paymentId: string) {
  const all = listRefunds(workspaceId, { paymentId, limit: 1 });
  return all.items[0];
}
