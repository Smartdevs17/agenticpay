import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetForTests, evaluateRefund, upsertRefundPolicy, listRefunds, listRefundPolicies, approveRefund, rejectRefund, processRefund } from '../../services/refund-engine.js';
import { refundNotificationService } from '../../services/refund-notifications.js';

describe('RefundsAutomated', () => {
  beforeEach(() => {
    resetForTests();
    refundNotificationService.resetForTests();
  });

  describe('Evaluation', () => {
    it('evaluates a refund request through the service', () => {
      const result = evaluateRefund({
        workspaceId: 'ws-1',
        paymentId: 'pay-1',
        paymentType: 'card',
        amountPaid: 1000,
        requestedAmount: 20,
        currency: 'USD',
        daysSincePayment: 5,
        reason: 'Customer request',
        hasChargeback: false,
        hasDispute: false,
      });
      expect(result.decision).toBe('approved');
      expect(result.amountApproved).toBe(20);
    });
  });

  describe('List refunds', () => {
    it('lists refunds after evaluation', () => {
      evaluateRefund({
        workspaceId: 'ws-1',
        paymentId: 'pay-1',
        paymentType: 'card',
        amountPaid: 1000,
        requestedAmount: 20,
        currency: 'USD',
        daysSincePayment: 5,
        reason: 'Test',
        hasChargeback: false,
        hasDispute: false,
      });

      const result = listRefunds('ws-1');
      expect(result.total).toBe(1);
      expect(result.items[0].paymentId).toBe('pay-1');
    });
  });

  describe('Policy management', () => {
    it('creates a policy', () => {
      const policy = upsertRefundPolicy({
        workspaceId: 'ws-1',
        name: 'test-policy',
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
      expect(policy.name).toBe('test-policy');
      expect(policy.fullRefundWindowDays).toBe(14);
    });

    it('lists policies', () => {
      upsertRefundPolicy({
        workspaceId: 'ws-1',
        name: 'policy-1',
        fullRefundWindowDays: 30,
        autoApprovalThreshold: 100,
        alwaysRefundUnderAmount: 25,
        maxPartialRefundPct: 100,
        requireReason: true,
        firstApprovalThreshold: 500,
        secondApprovalThreshold: 5000,
        rules: [],
        isActive: true,
      });

      const policies = listRefundPolicies('ws-1');
      expect(policies).toHaveLength(1);
      expect(policies[0].name).toBe('policy-1');
    });
  });

  describe('Webhooks', () => {
    it('subscribes a webhook via the notification service', () => {
      refundNotificationService.subscribeWebhook('ws-1', 'https://example.com/refund-hook', ['refund.completed', 'refund.failed']);
      const subs = refundNotificationService.listWebhookSubscriptions('ws-1');
      expect(subs).toHaveLength(1);
      expect(subs[0].url).toBe('https://example.com/refund-hook');
    });
  });

  describe('Approval workflow', () => {
    it('approves a refund through service', () => {
      // amount 1000 with amountPaid 10000 and daysSincePayment 60
      // -> within secondApprovalThreshold(5000) -> requires second level
      const evalResult = evaluateRefund({
        workspaceId: 'ws-1',
        paymentId: 'pay-1',
        paymentType: 'card',
        amountPaid: 10000,
        requestedAmount: 1000,
        currency: 'USD',
        daysSincePayment: 60,
        reason: 'Product issue',
        hasChargeback: false,
        hasDispute: false,
      });
      expect(evalResult.decision).toBe('manual_review');
      expect(evalResult.requiredApprovalLevel).toBe('second');

      const refunds = listRefunds('ws-1');
      expect(refunds.items).toHaveLength(1);

      const approved = approveRefund(refunds.items[0].id, 'admin-1', 'second');
      expect(approved.status).toBe('approved');
    });

    it('rejects a refund through service', () => {
      const evalResult = evaluateRefund({
        workspaceId: 'ws-1',
        paymentId: 'pay-1',
        paymentType: 'card',
        amountPaid: 10000,
        requestedAmount: 1000,
        currency: 'USD',
        daysSincePayment: 60,
        reason: 'Product issue',
        hasChargeback: false,
        hasDispute: false,
      });
      expect(evalResult.decision).toBe('manual_review');
      expect(evalResult.requiredApprovalLevel).toBe('second');

      const refunds = listRefunds('ws-1');
      const rejected = rejectRefund(refunds.items[0].id, 'admin-1', 'second', 'Not eligible');
      expect(rejected.status).toBe('rejected');
    });

    it('processes an approved refund through service', async () => {
      evaluateRefund({
        workspaceId: 'ws-1',
        paymentId: 'pay-1',
        paymentType: 'card',
        amountPaid: 1000,
        requestedAmount: 20,
        currency: 'USD',
        daysSincePayment: 5,
        reason: 'Test',
        hasChargeback: false,
        hasDispute: false,
      });

      const refunds = listRefunds('ws-1');
      const processed = await processRefund(refunds.items[0].id);
      expect(processed.status).toBe('completed');
    });
  });
});
