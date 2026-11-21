import { notificationDispatcher } from '../notifications/dispatcher.js';
import { channelRegistry } from '../notifications/channel-registry.js';
import type { Notification, NotificationChannel } from '../notifications/channel-interface.js';
import { getRefund, type RefundRecord } from './refund-engine.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RefundNotificationEvent {
  type: 'refund.created' | 'refund.approved' | 'refund.rejected' | 'refund.processing' | 'refund.completed' | 'refund.failed' | 'refund.cancelled' | 'refund.pending_review' | 'refund.auto_processed';
  refundId: string;
  workspaceId: string;
  paymentId: string;
  amount: number;
  currency: string;
  reason?: string;
  status: string;
  timestamp: string;
}

export interface RefundNotificationResult {
  notificationId: string;
  channels: string[];
  success: boolean;
}

// ── Notification Service ─────────────────────────────────────────────────────

class RefundNotificationService {
  private webhookSubscribers = new Map<string, Array<{
    url: string;
    events: string[];
    secret?: string;
  }>>();

  // ── Webhook Subscription Management ───────────────────────────────────────

  subscribeWebhook(
    workspaceId: string,
    url: string,
    events: string[],
    secret?: string,
  ): void {
    const existing = this.webhookSubscribers.get(workspaceId) ?? [];
    existing.push({ url, events, secret });
    this.webhookSubscribers.set(workspaceId, existing);
  }

  unsubscribeWebhook(workspaceId: string, url: string): boolean {
    const existing = this.webhookSubscribers.get(workspaceId);
    if (!existing) return false;
    const filtered = existing.filter((s) => s.url !== url);
    if (filtered.length === existing.length) return false;
    this.webhookSubscribers.set(workspaceId, filtered);
    return true;
  }

  listWebhookSubscriptions(workspaceId: string): Array<{ url: string; events: string[] }> {
    return (this.webhookSubscribers.get(workspaceId) ?? []).map(({ url, events }) => ({ url, events }));
  }

  // ── Test Helpers ────────────────────────────────────────────────────────────

  resetForTests(): void {
    this.webhookSubscribers.clear();
  }

  // ── Event Dispatch ────────────────────────────────────────────────────────

  async notifyRefundCreated(refund: RefundRecord): Promise<RefundNotificationResult> {
    return this.dispatchNotification({
      type: 'refund.created',
      refundId: refund.id,
      workspaceId: refund.workspaceId,
      paymentId: refund.paymentId,
      amount: refund.amount,
      currency: refund.currency,
      reason: refund.reason,
      status: refund.status,
      timestamp: new Date().toISOString(),
    });
  }

  async notifyRefundApproved(refund: RefundRecord): Promise<RefundNotificationResult> {
    return this.dispatchNotification({
      type: 'refund.approved',
      refundId: refund.id,
      workspaceId: refund.workspaceId,
      paymentId: refund.paymentId,
      amount: refund.amount,
      currency: refund.currency,
      reason: refund.reason,
      status: refund.status,
      timestamp: new Date().toISOString(),
    });
  }

  async notifyRefundRejected(refund: RefundRecord): Promise<RefundNotificationResult> {
    return this.dispatchNotification({
      type: 'refund.rejected',
      refundId: refund.id,
      workspaceId: refund.workspaceId,
      paymentId: refund.paymentId,
      amount: refund.amount,
      currency: refund.currency,
      reason: refund.reason,
      status: refund.status,
      timestamp: new Date().toISOString(),
    });
  }

  async notifyRefundCompleted(refund: RefundRecord): Promise<RefundNotificationResult> {
    return this.dispatchNotification({
      type: 'refund.completed',
      refundId: refund.id,
      workspaceId: refund.workspaceId,
      paymentId: refund.paymentId,
      amount: refund.amount,
      currency: refund.currency,
      reason: refund.reason,
      status: refund.status,
      timestamp: new Date().toISOString(),
    });
  }

  async notifyRefundFailed(refund: RefundRecord): Promise<RefundNotificationResult> {
    return this.dispatchNotification({
      type: 'refund.failed',
      refundId: refund.id,
      workspaceId: refund.workspaceId,
      paymentId: refund.paymentId,
      amount: refund.amount,
      currency: refund.currency,
      reason: refund.reason,
      status: refund.status,
      timestamp: new Date().toISOString(),
    });
  }

  async notifyRefundCancelled(refund: RefundRecord): Promise<RefundNotificationResult> {
    return this.dispatchNotification({
      type: 'refund.cancelled',
      refundId: refund.id,
      workspaceId: refund.workspaceId,
      paymentId: refund.paymentId,
      amount: refund.amount,
      currency: refund.currency,
      reason: refund.reason,
      status: refund.status,
      timestamp: new Date().toISOString(),
    });
  }

  async notifyRefundPendingReview(refund: RefundRecord): Promise<RefundNotificationResult> {
    return this.dispatchNotification({
      type: 'refund.pending_review',
      refundId: refund.id,
      workspaceId: refund.workspaceId,
      paymentId: refund.paymentId,
      amount: refund.amount,
      currency: refund.currency,
      reason: refund.reason,
      status: refund.status,
      timestamp: new Date().toISOString(),
    });
  }

  async notifyRefundAutoProcessed(refund: RefundRecord): Promise<RefundNotificationResult> {
    return this.dispatchNotification({
      type: 'refund.auto_processed',
      refundId: refund.id,
      workspaceId: refund.workspaceId,
      paymentId: refund.paymentId,
      amount: refund.amount,
      currency: refund.currency,
      reason: refund.reason,
      status: refund.status,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Internal Dispatch ─────────────────────────────────────────────────────

  private async dispatchNotification(event: RefundNotificationEvent): Promise<RefundNotificationResult> {
    const channels: string[] = [];
    let success = false;

    // Fire webhooks
    const webhooks = this.webhookSubscribers.get(event.workspaceId) ?? [];
    const relevantWebhooks = webhooks.filter((w) =>
      w.events.includes('*') || w.events.includes(event.type),
    );

    for (const webhook of relevantWebhooks) {
      try {
        await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(webhook.secret ? { 'X-Webhook-Signature': webhook.secret } : {}),
          },
          body: JSON.stringify({
            event: event.type,
            data: {
              refundId: event.refundId,
              paymentId: event.paymentId,
              amount: event.amount,
              currency: event.currency,
              reason: event.reason,
              status: event.status,
              timestamp: event.timestamp,
            },
            timestamp: event.timestamp,
          }),
        });
        channels.push(`webhook:${webhook.url}`);
        success = true;
      } catch {
        // Best-effort webhook delivery
      }
    }

    // Dispatch via notification channels
    const notification: Notification = {
      id: `refund-notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: event.workspaceId,
      eventType: event.type,
      title: this.getNotificationTitle(event),
      body: this.getNotificationBody(event),
      priority: event.type === 'refund.failed' ? 'high' : 'normal',
      data: event as unknown as Record<string, unknown>,
      createdAt: new Date(),
    };

    try {
      const result = await notificationDispatcher.dispatch(notification);
      if (result.success) {
        channels.push(...result.deliveries.map((d) => d.channelId));
        success = true;
      }
    } catch {
      // Best-effort notification dispatch
    }

    return {
      notificationId: notification.id,
      channels,
      success,
    };
  }

  private getNotificationTitle(event: RefundNotificationEvent): string {
    const titles: Record<string, string> = {
      'refund.created': 'Refund Request Created',
      'refund.approved': 'Refund Approved',
      'refund.rejected': 'Refund Rejected',
      'refund.processing': 'Refund Processing',
      'refund.completed': 'Refund Completed',
      'refund.failed': 'Refund Failed',
      'refund.cancelled': 'Refund Cancelled',
      'refund.pending_review': 'Refund Requires Review',
      'refund.auto_processed': 'Refund Auto-Processed',
    };
    return titles[event.type] ?? 'Refund Update';
  }

  private getNotificationBody(event: RefundNotificationEvent): string {
    const amountStr = `${event.amount} ${event.currency}`;
    const bodies: Record<string, string> = {
      'refund.created': `Refund request for ${amountStr} has been created.`,
      'refund.approved': `Refund for ${amountStr} has been approved.`,
      'refund.rejected': `Refund for ${amountStr} has been rejected.`,
      'refund.processing': `Refund for ${amountStr} is being processed.`,
      'refund.completed': `Refund for ${amountStr} has been completed successfully.`,
      'refund.failed': `Refund for ${amountStr} has failed. Please review and retry.`,
      'refund.cancelled': `Refund for ${amountStr} has been cancelled.`,
      'refund.pending_review': `Refund for ${amountStr} requires manual review.`,
      'refund.auto_processed': `Refund for ${amountStr} has been automatically processed.`,
    };
    return bodies[event.type] ?? `Refund update: ${event.status}`;
  }
}

export const refundNotificationService = new RefundNotificationService();
