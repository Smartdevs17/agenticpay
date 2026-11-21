import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { RazorpayClient } from '../razorpay-client.js';
import { RazorpayGatewayAdapter } from '../gateway-adapter.js';
import type { RazorpayWebhookPayload } from '../types.js';

describe('RazorpayClient', () => {
  let client: RazorpayClient;
  const originalFetch = global.fetch;

  beforeEach(() => {
    client = new RazorpayClient({
      keyId: 'rzp_test_123',
      keySecret: 'secret_456',
      webhookSecret: 'webhook_secret_789',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('correctly verifies payment HMAC-SHA256 signature', () => {
    const orderId = 'order_ABC123';
    const paymentId = 'pay_XYZ789';
    const secret = 'secret_456';

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const isValid = client.verifyPaymentSignature(orderId, paymentId, expectedSignature, secret);
    expect(isValid).toBe(true);
  });

  it('rejects tampered payment signature', () => {
    const isValid = client.verifyPaymentSignature('order_ABC123', 'pay_XYZ789', 'invalid_sig');
    expect(isValid).toBe(false);
  });

  it('correctly verifies webhook signature over raw payload', () => {
    const secret = 'webhook_secret_789';
    const rawBody = JSON.stringify({
      entity: 'event',
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_123' } } },
    });

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const isValid = client.verifyWebhookSignature(rawBody, expectedSignature, secret);
    expect(isValid).toBe(true);
  });

  it('rejects invalid webhook signature', () => {
    const rawBody = JSON.stringify({ entity: 'event' });
    const isValid = client.verifyWebhookSignature(rawBody, 'wrong_hex_signature');
    expect(isValid).toBe(false);
  });

  it('creates simulated order when credentials are not configured', async () => {
    const unconfiguredClient = new RazorpayClient();
    const order = await unconfiguredClient.createOrder({
      amount: 50000,
      currency: 'INR',
      receipt: 'rcpt_001',
    });

    expect(order.id).toMatch(/^order_sim_/);
    expect(order.amount).toBe(50000);
    expect(order.currency).toBe('INR');
    expect(order.status).toBe('created');
  });

  it('creates order via API when credentials are provided', async () => {
    const mockOrderResponse = {
      id: 'order_api_999',
      entity: 'order',
      amount: 25000,
      currency: 'INR',
      status: 'created',
      receipt: 'rcpt_002',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOrderResponse,
    } as any);

    const order = await client.createOrder({
      amount: 25000,
      currency: 'INR',
      receipt: 'rcpt_002',
    });

    expect(order.id).toBe('order_api_999');
    expect(order.amount).toBe(25000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws an error when order creation API fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { description: 'Bad request payload' } }),
    } as any);

    await expect(
      client.createOrder({ amount: 100, currency: 'INR' })
    ).rejects.toThrow('Razorpay order creation failed (400)');
  });

  it('captures a payment', async () => {
    const mockCaptureResponse = {
      id: 'pay_capture_123',
      entity: 'payment',
      amount: 10000,
      currency: 'INR',
      status: 'captured',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockCaptureResponse,
    } as any);

    const payment = await client.capturePayment('pay_capture_123', 10000, 'INR');
    expect(payment.status).toBe('captured');
    expect(payment.id).toBe('pay_capture_123');
  });

  it('creates a refund', async () => {
    const mockRefundResponse = {
      id: 'rfnd_123',
      entity: 'refund',
      amount: 5000,
      currency: 'INR',
      payment_id: 'pay_123',
      status: 'processed',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRefundResponse,
    } as any);

    const refund = await client.createRefund({
      paymentId: 'pay_123',
      amount: 5000,
    });

    expect(refund.id).toBe('rfnd_123');
    expect(refund.status).toBe('processed');
  });
});

describe('RazorpayGatewayAdapter', () => {
  let adapter: RazorpayGatewayAdapter;

  beforeEach(() => {
    adapter = new RazorpayGatewayAdapter({
      enabled: true,
      priority: 1,
      maxRetries: 0,
      timeoutMs: 1000,
      healthCheckIntervalMs: 60000,
      circuitBreakerThreshold: 3,
      credentials: {},
    });
  });

  it('identifies as razorpay gateway type', () => {
    expect(adapter.getType()).toBe('razorpay');
  });

  it('processes payment requests via gateway adapter interface', async () => {
    const response = await adapter.processPayment({
      amount: '300.00',
      currency: 'INR',
      recipient: 'user_recip_razorpay',
      idempotencyKey: 'idemp_rzp_1',
      metadata: {
        receipt: 'rcpt_adapter_1',
      },
    });

    expect(response.success).toBe(true);
    expect(response.status).toBe('pending');
    expect(response.transactionId).toBeDefined();
    expect(adapter.getHealthStatus().isHealthy).toBe(true);
  });

  it('performs health check', async () => {
    const isHealthy = await adapter.checkHealth();
    expect(isHealthy).toBe(true);
    const health = adapter.getHealthStatus();
    expect(health.gatewayType).toBe('razorpay');
    expect(health.isHealthy).toBe(true);
  });
});
