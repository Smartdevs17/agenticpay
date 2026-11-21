import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express } from 'express';
import { zapierRouter } from '../zapier.js';
import { zapierWebhookService } from '../../integrations/zapier/zapier-webhook-service.js';
import { errorHandler } from '../../middleware/errorHandler.js';

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/zapier', zapierRouter);
  app.use(errorHandler);
  return app;
}

// Simple request helper using standard fetch & node http server
async function testRequest(
  app: Express,
  path: string,
  options: {
    method?: string;
    body?: any;
    headers?: Record<string, string>;
  } = {}
) {
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const url = `http://127.0.0.1:${port}${path}`;

  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const status = res.status;
    let body: any;
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status, body };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('Zapier Routes (/api/v1/zapier)', () => {
  let app: Express;

  beforeEach(() => {
    zapierWebhookService.clearSubscriptions();
    app = createTestApp();
  });

  describe('POST /api/v1/zapier/hooks/subscribe', () => {
    it('creates a subscription with 201 status', async () => {
      const res = await testRequest(app, '/api/v1/zapier/hooks/subscribe', {
        method: 'POST',
        body: {
          hookUrl: 'https://hooks.zapier.com/hooks/catch/123/sub',
          event: 'payment.succeeded',
          merchantId: 'merch-001',
        },
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^zap_sub_/);
      expect(res.body.hookUrl).toBe('https://hooks.zapier.com/hooks/catch/123/sub');
      expect(res.body.event).toBe('payment.succeeded');
      expect(res.body.status).toBe('active');
    });

    it('rejects invalid hookUrl with 400', async () => {
      const res = await testRequest(app, '/api/v1/zapier/hooks/subscribe', {
        method: 'POST',
        body: {
          hookUrl: 'not-a-valid-url',
          event: 'payment.succeeded',
        },
      });

      expect(res.status).toBe(400);
      expect(res.body.error || res.body.message).toBeDefined();
    });

    it('rejects unsupported event with 400', async () => {
      const res = await testRequest(app, '/api/v1/zapier/hooks/subscribe', {
        method: 'POST',
        body: {
          hookUrl: 'https://hooks.zapier.com/hooks/catch/123/sub',
          event: 'unsupported.event',
        },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE & POST /api/v1/zapier/hooks/unsubscribe', () => {
    it('unsubscribes by ID with DELETE', async () => {
      const sub = await zapierWebhookService.subscribe({
        hookUrl: 'https://hooks.zapier.com/hooks/catch/123/delete-me',
        event: 'invoice.paid',
      });

      const res = await testRequest(app, `/api/v1/zapier/hooks/unsubscribe/${sub.id}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when unsubscribing non-existent subscription', async () => {
      const res = await testRequest(app, '/api/v1/zapier/hooks/unsubscribe/non-existent-id', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('unsubscribes via POST body', async () => {
      await zapierWebhookService.subscribe({
        hookUrl: 'https://hooks.zapier.com/hooks/catch/123/post-unsub',
        event: 'dispute.opened',
      });

      const res = await testRequest(app, '/api/v1/zapier/hooks/unsubscribe', {
        method: 'POST',
        body: { hookUrl: 'https://hooks.zapier.com/hooks/catch/123/post-unsub' },
      });

      expect(res.status).toBe(200);
      expect(res.body.unsubscribedCount).toBe(1);
    });
  });

  describe('GET /api/v1/zapier/triggers', () => {
    it('lists all supported triggers', async () => {
      const res = await testRequest(app, '/api/v1/zapier/triggers');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.triggers)).toBe(true);
      expect(res.body.triggers.some((t: any) => t.event === 'payment.succeeded')).toBe(true);
    });

    it('returns sample data array for valid trigger event', async () => {
      const res = await testRequest(app, '/api/v1/zapier/triggers/payment.succeeded/sample');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].id).toBeDefined();
      expect(res.body[0].status).toBe('succeeded');
    });

    it('returns 400 for unknown trigger event sample', async () => {
      const res = await testRequest(app, '/api/v1/zapier/triggers/unknown.trigger/sample');
      expect(res.status).toBe(400);
    });
  });

  describe('Actions (/api/v1/zapier/actions/*)', () => {
    it('creates an invoice via action', async () => {
      const res = await testRequest(app, '/api/v1/zapier/actions/invoice', {
        method: 'POST',
        body: {
          customerName: 'Robert Paulson',
          customerEmail: 'robert@example.com',
          amount: 250,
          currency: 'USD',
          description: 'Custom Zapier Order',
        },
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^inv_/);
      expect(res.body.customerName).toBe('Robert Paulson');
      expect(res.body.amount).toBe(250);
      expect(res.body.status).toBe('issued');
    });

    it('creates a payment link via action', async () => {
      const res = await testRequest(app, '/api/v1/zapier/actions/payment-link', {
        method: 'POST',
        body: {
          title: 'Donation Fund',
          amount: 25,
          currency: 'USD',
        },
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^link_/);
      expect(res.body.title).toBe('Donation Fund');
      expect(res.body.url).toBeDefined();
    });

    it('issues a refund via action', async () => {
      const res = await testRequest(app, '/api/v1/zapier/actions/refund', {
        method: 'POST',
        body: {
          paymentId: 'pay_998877',
          amount: 15,
          reason: 'Product defective',
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.paymentId).toBe('pay_998877');
      expect(res.body.status).toBe('completed');
    });

    it('verifies a payment via action', async () => {
      const res = await testRequest(app, '/api/v1/zapier/actions/verify', {
        method: 'POST',
        body: {
          paymentId: 'pay_998877',
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.verified).toBe(true);
      expect(res.body.status).toBe('confirmed');
    });
  });

  describe('POST /api/v1/zapier/webhooks (Inbound Webhook Catch)', () => {
    it('accepts inbound webhook without signature when no secret configured', async () => {
      const res = await testRequest(app, '/api/v1/zapier/webhooks', {
        method: 'POST',
        body: {
          event: 'crm.contact_created',
          contact: { name: 'Alice' },
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(res.body.eventId).toBeDefined();
    });
  });
});
