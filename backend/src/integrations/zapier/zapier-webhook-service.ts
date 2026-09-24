import { randomUUID } from 'node:crypto';
import type {
  ZapierSubscription,
  ZapierSubscribeInput,
  ZapierTriggerType,
  ZapierEventPayload,
  ZapierDeliveryResult,
  ZapierCreateInvoiceInput,
  ZapierCreatePaymentLinkInput,
  ZapierIssueRefundInput,
  ZapierVerifyPaymentInput,
} from './types.js';
import { zapierClient, ZapierClient } from './zapier-client.js';

export class ZapierWebhookService {
  private readonly subscriptions = new Map<string, ZapierSubscription>();
  private readonly deliveryHistory: ZapierDeliveryResult[] = [];
  private readonly client: ZapierClient;

  constructor(client: ZapierClient = zapierClient) {
    this.client = client;
  }

  // ---------------------------------------------------------------------------
  // Subscription Lifecycle (Zapier REST Hooks)
  // ---------------------------------------------------------------------------

  /**
   * Subscribe a new Zapier hook URL to an event.
   */
  async subscribe(input: ZapierSubscribeInput): Promise<ZapierSubscription> {
    const existing = Array.from(this.subscriptions.values()).find(
      (sub) => sub.hookUrl === input.hookUrl && sub.event === input.event
    );

    const now = new Date().toISOString();

    if (existing) {
      existing.status = 'active';
      existing.updatedAt = now;
      if (input.secret) existing.secret = input.secret;
      if (input.merchantId) existing.merchantId = input.merchantId;
      this.subscriptions.set(existing.id, existing);
      return existing;
    }

    const subscription: ZapierSubscription = {
      id: `zap_sub_${randomUUID()}`,
      hookUrl: input.hookUrl,
      event: input.event,
      targetUrl: input.targetUrl,
      merchantId: input.merchantId,
      secret: input.secret,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  /**
   * Unsubscribe by subscription ID or hook URL.
   */
  async unsubscribe(id?: string, hookUrl?: string): Promise<{ success: boolean; unsubscribedCount: number }> {
    let count = 0;

    if (id && this.subscriptions.has(id)) {
      this.subscriptions.delete(id);
      count++;
    }

    if (hookUrl) {
      for (const [subId, sub] of this.subscriptions.entries()) {
        if (sub.hookUrl === hookUrl) {
          this.subscriptions.delete(subId);
          count++;
        }
      }
    }

    return { success: count > 0, unsubscribedCount: count };
  }

  /**
   * List all subscriptions, optionally filtered by merchantId or status.
   */
  listSubscriptions(merchantId?: string, status?: 'active' | 'paused' | 'disabled'): ZapierSubscription[] {
    let subs = Array.from(this.subscriptions.values());
    if (merchantId) {
      subs = subs.filter((s) => !s.merchantId || s.merchantId === merchantId);
    }
    if (status) {
      subs = subs.filter((s) => s.status === status);
    }
    return subs;
  }

  /**
   * Get subscription by ID.
   */
  getSubscription(id: string): ZapierSubscription | undefined {
    return this.subscriptions.get(id);
  }

  /**
   * Clear all subscriptions (useful for tests).
   */
  clearSubscriptions(): void {
    this.subscriptions.clear();
    this.deliveryHistory.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Outbound Trigger Dispatching
  // ---------------------------------------------------------------------------

  /**
   * Broadcast an event to all matching Zapier subscriptions.
   */
  async dispatchTrigger<T extends Record<string, unknown>>(
    event: ZapierTriggerType,
    data: T,
    merchantId?: string
  ): Promise<ZapierDeliveryResult[]> {
    const matchingSubs = Array.from(this.subscriptions.values()).filter(
      (sub) =>
        sub.status === 'active' &&
        sub.event === event &&
        (!merchantId || !sub.merchantId || sub.merchantId === merchantId)
    );

    if (matchingSubs.length === 0) {
      return [];
    }

    const eventPayload: ZapierEventPayload<T> = {
      id: `zap_evt_${randomUUID()}`,
      event,
      timestamp: new Date().toISOString(),
      merchantId,
      data,
    };

    const deliveryPromises = matchingSubs.map((sub) =>
      this.client.sendWebhook(sub.id, sub.hookUrl, eventPayload, sub.secret)
    );

    const results = await Promise.all(deliveryPromises);
    this.deliveryHistory.push(...results);
    return results;
  }

  /**
   * Get delivery history.
   */
  getDeliveryHistory(limit = 50): ZapierDeliveryResult[] {
    return this.deliveryHistory.slice(-limit);
  }

  // ---------------------------------------------------------------------------
  // Trigger Sample Payloads (Zapier Visual Builder Testing)
  // ---------------------------------------------------------------------------

  /**
   * Generates realistic sample data for Zapier triggers so users can configure field mapping in Zaps.
   */
  getSamplePayload(event: ZapierTriggerType): Record<string, unknown> {
    const now = new Date().toISOString();

    switch (event) {
      case 'payment.succeeded':
        return {
          id: 'pay_sample_98439201',
          status: 'succeeded',
          amount: 150.0,
          currency: 'USD',
          merchantId: 'merch_01h8q2',
          customer: {
            id: 'cus_99321',
            email: 'jane.doe@example.com',
            name: 'Jane Doe',
          },
          paymentMethod: 'stellar_usdc',
          stellarTxHash: '9d4fae09c85112e3e56a4225be69c4b14d2325c88b7f8df20b419b4564c7ad01',
          fee: 0.15,
          netAmount: 149.85,
          createdAt: now,
          description: 'Software subscription license renewal',
        };

      case 'payment.failed':
        return {
          id: 'pay_sample_fail_102',
          status: 'failed',
          amount: 250.0,
          currency: 'USD',
          merchantId: 'merch_01h8q2',
          customerEmail: 'alex.smith@example.com',
          errorCode: 'INSUFFICIENT_FUNDS',
          errorMessage: 'Stellar account balance insufficient for asset transfer',
          failedAt: now,
        };

      case 'invoice.created':
        return {
          id: 'inv_sample_4821',
          invoiceNumber: 'INV-2026-0042',
          status: 'issued',
          amount: 500.0,
          currency: 'USD',
          customerName: 'Acme Corporation',
          customerEmail: 'billing@acme.example.com',
          dueDate: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
          paymentLink: 'https://agenticpay.com/pay/inv_sample_4821',
          lineItems: [
            { description: 'Cloud AI Agent Credits', quantity: 1, unitPrice: 500.0 },
          ],
          createdAt: now,
        };

      case 'invoice.paid':
        return {
          id: 'inv_sample_4821',
          invoiceNumber: 'INV-2026-0042',
          status: 'paid',
          amount: 500.0,
          currency: 'USD',
          customerEmail: 'billing@acme.example.com',
          paidAt: now,
          paymentId: 'pay_sample_98439201',
        };

      case 'dispute.opened':
        return {
          id: 'disp_sample_882',
          paymentId: 'pay_sample_98439201',
          amount: 150.0,
          currency: 'USD',
          reason: 'unrecognized_transaction',
          status: 'needs_response',
          evidenceDueBy: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          createdAt: now,
        };

      case 'dispute.resolved':
        return {
          id: 'disp_sample_882',
          paymentId: 'pay_sample_98439201',
          status: 'won',
          resolution: 'merchant_favored',
          resolvedAt: now,
        };

      case 'refund.created':
        return {
          id: 'ref_sample_731',
          paymentId: 'pay_sample_98439201',
          amount: 150.0,
          currency: 'USD',
          status: 'pending',
          reason: 'Customer requested refund via Zapier',
          createdAt: now,
        };

      case 'refund.completed':
        return {
          id: 'ref_sample_731',
          paymentId: 'pay_sample_98439201',
          amount: 150.0,
          currency: 'USD',
          status: 'completed',
          completedAt: now,
        };

      case 'webhook.test':
      default:
        return {
          id: 'test_evt_001',
          event: 'webhook.test',
          message: 'AgenticPay Zapier webhook connection verified successfully!',
          timestamp: now,
        };
    }
  }

  // ---------------------------------------------------------------------------
  // Action Handlers (Inbound Zapier Action Execution)
  // ---------------------------------------------------------------------------

  /**
   * Execute Action: Create Invoice
   */
  async executeCreateInvoice(input: ZapierCreateInvoiceInput): Promise<Record<string, unknown>> {
    const invoiceId = `inv_${randomUUID()}`;
    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
    const now = new Date().toISOString();
    const dueDate = input.dueDate || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    const invoice = {
      id: invoiceId,
      invoiceNumber,
      merchantId: input.merchantId,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      description: input.description || 'Invoice created via Zapier',
      status: 'issued',
      dueDate,
      paymentUrl: `https://agenticpay.com/pay/${invoiceId}`,
      metadata: input.metadata || {},
      createdAt: now,
    };

    return invoice;
  }

  /**
   * Execute Action: Create Payment Link
   */
  async executeCreatePaymentLink(input: ZapierCreatePaymentLinkInput): Promise<Record<string, unknown>> {
    const linkId = `link_${randomUUID()}`;
    const now = new Date().toISOString();

    const paymentLink = {
      id: linkId,
      merchantId: input.merchantId,
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      title: input.title,
      description: input.description || '',
      url: `https://agenticpay.com/pay/${linkId}`,
      redirectUrl: input.redirectUrl,
      status: 'active',
      metadata: input.metadata || {},
      createdAt: now,
    };

    return paymentLink;
  }

  /**
   * Execute Action: Issue Refund
   */
  async executeIssueRefund(input: ZapierIssueRefundInput): Promise<Record<string, unknown>> {
    const refundId = `ref_${randomUUID()}`;
    const now = new Date().toISOString();

    const refund = {
      id: refundId,
      paymentId: input.paymentId,
      amount: input.amount ?? 0,
      reason: input.reason,
      merchantId: input.merchantId || 'default-merchant',
      status: 'completed',
      createdAt: now,
    };

    return refund;
  }

  /**
   * Execute Action: Verify Payment
   */
  async executeVerifyPayment(input: ZapierVerifyPaymentInput): Promise<Record<string, unknown>> {
    return {
      paymentId: input.paymentId,
      verified: true,
      status: 'confirmed',
      settlementNetwork: 'stellar',
      verifiedAt: new Date().toISOString(),
    };
  }
}

export const zapierWebhookService = new ZapierWebhookService();
