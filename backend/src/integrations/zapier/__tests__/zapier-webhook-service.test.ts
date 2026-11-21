import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ZapierWebhookService } from '../zapier-webhook-service.js';
import { ZapierClient } from '../zapier-client.js';

describe('ZapierWebhookService', () => {
  let service: ZapierWebhookService;
  let mockClient: ZapierClient;

  beforeEach(() => {
    mockClient = new ZapierClient();
    service = new ZapierWebhookService(mockClient);
    service.clearSubscriptions();
  });

  describe('REST Hook Subscription Management', () => {
    it('creates a new subscription', async () => {
      const sub = await service.subscribe({
        hookUrl: 'https://hooks.zapier.com/hooks/catch/111/aaa',
        event: 'payment.succeeded',
        merchantId: 'merch-1',
      });

      expect(sub.id).toMatch(/^zap_sub_/);
      expect(sub.hookUrl).toBe('https://hooks.zapier.com/hooks/catch/111/aaa');
      expect(sub.event).toBe('payment.succeeded');
      expect(sub.merchantId).toBe('merch-1');
      expect(sub.status).toBe('active');

      const listed = service.listSubscriptions();
      expect(listed).toHaveLength(1);
    });

    it('updates an existing subscription if same hookUrl and event are submitted', async () => {
      const sub1 = await service.subscribe({
        hookUrl: 'https://hooks.zapier.com/hooks/catch/111/aaa',
        event: 'payment.succeeded',
        secret: 'old-secret-1234567890123456',
      });

      const sub2 = await service.subscribe({
        hookUrl: 'https://hooks.zapier.com/hooks/catch/111/aaa',
        event: 'payment.succeeded',
        secret: 'new-secret-1234567890123456',
      });

      expect(sub1.id).toBe(sub2.id);
      expect(sub2.secret).toBe('new-secret-1234567890123456');
      expect(service.listSubscriptions()).toHaveLength(1);
    });

    it('unsubscribes by ID', async () => {
      const sub = await service.subscribe({
        hookUrl: 'https://hooks.zapier.com/hooks/catch/222/bbb',
        event: 'invoice.created',
      });

      const res = await service.unsubscribe(sub.id);
      expect(res.success).toBe(true);
      expect(res.unsubscribedCount).toBe(1);
      expect(service.listSubscriptions()).toHaveLength(0);
    });

    it('unsubscribes by hookUrl', async () => {
      await service.subscribe({
        hookUrl: 'https://hooks.zapier.com/hooks/catch/333/ccc',
        event: 'dispute.opened',
      });

      const res = await service.unsubscribe(undefined, 'https://hooks.zapier.com/hooks/catch/333/ccc');
      expect(res.success).toBe(true);
      expect(res.unsubscribedCount).toBe(1);
      expect(service.listSubscriptions()).toHaveLength(0);
    });
  });

  describe('Trigger Dispatching', () => {
    it('dispatches trigger to matching subscriptions only', async () => {
      await service.subscribe({
        hookUrl: 'https://hooks.zapier.com/hooks/catch/444/ddd',
        event: 'payment.succeeded',
      });
      await service.subscribe({
        hookUrl: 'https://hooks.zapier.com/hooks/catch/555/eee',
        event: 'payment.failed',
      });

      const sendSpy = vi.spyOn(mockClient, 'sendWebhook').mockResolvedValue({
        subscriptionId: 'test-sub',
        hookUrl: 'test-url',
        statusCode: 200,
        success: true,
        latencyMs: 50,
      });

      const results = await service.dispatchTrigger('payment.succeeded', {
        amount: 250,
        currency: 'USD',
      });

      expect(results).toHaveLength(1);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.any(String),
        'https://hooks.zapier.com/hooks/catch/444/ddd',
        expect.objectContaining({
          event: 'payment.succeeded',
          data: { amount: 250, currency: 'USD' },
        }),
        undefined
      );
    });

    it('returns empty array when no active subscribers match', async () => {
      const results = await service.dispatchTrigger('refund.completed', {
        refundId: 'ref-1',
      });
      expect(results).toEqual([]);
    });
  });

  describe('Trigger Sample Payloads', () => {
    it('generates sample data for all supported triggers', () => {
      const events = [
        'payment.succeeded',
        'payment.failed',
        'invoice.created',
        'invoice.paid',
        'dispute.opened',
        'dispute.resolved',
        'refund.created',
        'refund.completed',
        'webhook.test',
      ] as const;

      for (const event of events) {
        const sample = service.getSamplePayload(event);
        expect(sample).toBeDefined();
        expect(typeof sample).toBe('object');
        expect(sample.id || sample.event).toBeDefined();
      }
    });
  });

  describe('Zapier Action Execution', () => {
    it('executes create invoice action', async () => {
      const invoice = await service.executeCreateInvoice({
        merchantId: 'merch-test',
        customerName: 'Alice',
        customerEmail: 'alice@example.com',
        amount: 199.99,
        currency: 'USD',
        description: 'Yearly subscription',
      });

      expect(invoice.id).toMatch(/^inv_/);
      expect(invoice.invoiceNumber).toMatch(/^INV-/);
      expect(invoice.amount).toBe(199.99);
      expect(invoice.status).toBe('issued');
      expect(invoice.customerEmail).toBe('alice@example.com');
    });

    it('executes create payment link action', async () => {
      const link = await service.executeCreatePaymentLink({
        merchantId: 'merch-test',
        amount: 50,
        currency: 'USD',
        title: 'Donation',
      });

      expect(link.id).toMatch(/^link_/);
      expect(link.url).toContain(link.id as string);
      expect(link.amount).toBe(50);
      expect(link.status).toBe('active');
    });

    it('executes issue refund action', async () => {
      const refund = await service.executeIssueRefund({
        paymentId: 'pay-12345',
        amount: 50,
        reason: 'Duplicate payment',
      });

      expect(refund.id).toMatch(/^ref_/);
      expect(refund.paymentId).toBe('pay-12345');
      expect(refund.status).toBe('completed');
    });

    it('executes verify payment action', async () => {
      const verified = await service.executeVerifyPayment({
        paymentId: 'pay-12345',
      });

      expect(verified.paymentId).toBe('pay-12345');
      expect(verified.verified).toBe(true);
      expect(verified.status).toBe('confirmed');
    });
  });
});
