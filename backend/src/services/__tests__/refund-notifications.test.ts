import { describe, it, expect, beforeEach } from 'vitest';
import { refundNotificationService } from '../refund-notifications.js';
import type { RefundRecord } from '../refund-engine.js';

const mockRefund = (overrides: Partial<RefundRecord> = {}): RefundRecord => ({
  id: 'refund-1',
  workspaceId: 'ws-1',
  paymentId: 'pay-1',
  paymentType: 'card',
  amount: 100,
  currency: 'USD',
  reason: 'Customer request',
  status: 'approved',
  decision: 'approved',
  decisionReasons: ['Within policy'],
  autoProcessed: true,
  lineItems: [],
  approvals: [],
  history: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('RefundNotificationService', () => {
  beforeEach(() => {
    refundNotificationService.resetForTests();
  });

  describe('webhook subscriptions', () => {
    it('subscribes a webhook', () => {
      refundNotificationService.subscribeWebhook('ws-1', 'https://example.com/hook', ['refund.completed']);
      const subs = refundNotificationService.listWebhookSubscriptions('ws-1');
      expect(subs).toHaveLength(1);
      expect(subs[0].url).toBe('https://example.com/hook');
    });

    it('supports wildcard event subscription', () => {
      refundNotificationService.subscribeWebhook('ws-1', 'https://example.com/wildcard-hook', ['*']);
      const subs = refundNotificationService.listWebhookSubscriptions('ws-1');
      const wildcardSub = subs.find((s) => s.url === 'https://example.com/wildcard-hook');
      expect(wildcardSub).toBeDefined();
      expect(wildcardSub!.events).toContain('*');
    });

    it('unsubscribes a webhook', () => {
      refundNotificationService.subscribeWebhook('ws-1', 'https://example.com/hook', ['refund.completed']);
      const removed = refundNotificationService.unsubscribeWebhook('ws-1', 'https://example.com/hook');
      expect(removed).toBe(true);
      expect(refundNotificationService.listWebhookSubscriptions('ws-1')).toHaveLength(0);
    });

    it('returns false when unsubscribing non-existent webhook', () => {
      const removed = refundNotificationService.unsubscribeWebhook('ws-1', 'https://example.com/nonexistent');
      expect(removed).toBe(false);
    });

    it('lists webhook subscriptions for workspace', () => {
      refundNotificationService.subscribeWebhook('ws-1', 'https://example.com/hook1', ['refund.completed']);
      refundNotificationService.subscribeWebhook('ws-1', 'https://example.com/hook2', ['refund.failed']);
      refundNotificationService.subscribeWebhook('ws-2', 'https://example.com/other', ['refund.created']);

      const subs = refundNotificationService.listWebhookSubscriptions('ws-1');
      expect(subs).toHaveLength(2);
    });
  });

  describe('notification methods', () => {
    it('creates notification for refund created', async () => {
      const refund = mockRefund({ status: 'pending' });
      const result = await refundNotificationService.notifyRefundCreated(refund);
      expect(result.notificationId).toBeDefined();
    });

    it('creates notification for refund completed', async () => {
      const refund = mockRefund({ status: 'completed' });
      const result = await refundNotificationService.notifyRefundCompleted(refund);
      expect(result.notificationId).toBeDefined();
    });

    it('creates notification for refund failed', async () => {
      const refund = mockRefund({ status: 'failed' });
      const result = await refundNotificationService.notifyRefundFailed(refund);
      expect(result.notificationId).toBeDefined();
    });

    it('creates notification for refund approved', async () => {
      const result = await refundNotificationService.notifyRefundApproved(mockRefund());
      expect(result.notificationId).toBeDefined();
    });

    it('creates notification for refund rejected', async () => {
      const refund = mockRefund({ status: 'rejected', decision: 'rejected' });
      const result = await refundNotificationService.notifyRefundRejected(refund);
      expect(result.notificationId).toBeDefined();
    });

    it('creates notification for refund cancelled', async () => {
      const refund = mockRefund({ status: 'cancelled' });
      const result = await refundNotificationService.notifyRefundCancelled(refund);
      expect(result.notificationId).toBeDefined();
    });

    it('creates notification for refund pending review', async () => {
      const refund = mockRefund({ status: 'pending' });
      const result = await refundNotificationService.notifyRefundPendingReview(refund);
      expect(result.notificationId).toBeDefined();
    });

    it('creates notification for refund auto-processed', async () => {
      const refund = mockRefund({ status: 'approved', autoProcessed: true });
      const result = await refundNotificationService.notifyRefundAutoProcessed(refund);
      expect(result.notificationId).toBeDefined();
    });
  });
});
