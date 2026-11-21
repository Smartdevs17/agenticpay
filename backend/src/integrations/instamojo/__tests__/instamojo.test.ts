import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InstamojoClient } from '../instamojo-client.js';
import { InstamojoGatewayAdapter } from '../gateway-adapter.js';
import type { InstamojoWebhookPayload } from '../types.js';

describe('InstamojoClient', () => {
  let client: InstamojoClient;
  const originalFetch = global.fetch;

  beforeEach(() => {
    client = new InstamojoClient({
      apiKey: 'test_api_key',
      authToken: 'test_auth_token',
      privateSalt: 'secret_salt_123',
      endpointUrl: 'https://test.instamojo.com/api/1.1/',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('correctly calculates and validates webhook MAC signature', () => {
    const salt = 'test_salt_xyz';
    const payload: InstamojoWebhookPayload = {
      payment_id: 'MOJO12345678',
      payment_request_id: 'req_abc123',
      status: 'Credit',
      amount: '500.00',
      buyer: 'buyer@example.com',
      buyer_name: 'Test Buyer',
      buyer_phone: '+919999999999',
      currency: 'INR',
      fees: '15.00',
    };

    // Calculate expected MAC
    const sortedKeys = Object.keys(payload).sort((a, b) => a.localeCompare(b));
    const message = sortedKeys.map((k) => String(payload[k])).join('|');
    const { createHmac } = require('node:crypto');
    const expectedMac = createHmac('sha1', salt).update(message).digest('hex');

    payload.mac = expectedMac;

    const isValid = client.verifyWebhookMac(payload, salt);
    expect(isValid).toBe(true);
  });

  it('rejects invalid webhook MAC signature', () => {
    const payload: InstamojoWebhookPayload = {
      payment_id: 'MOJO12345678',
      payment_request_id: 'req_abc123',
      status: 'Credit',
      amount: '500.00',
      mac: 'invalid_mac_signature',
    };

    const isValid = client.verifyWebhookMac(payload, 'test_salt_xyz');
    expect(isValid).toBe(false);
  });

  it('creates payment request successfully with API call', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        payment_request: {
          id: 'pr_real_123',
          phone: '+919876543210',
          email: 'customer@example.com',
          buyer_name: 'Jane Doe',
          amount: '250.00',
          purpose: 'Order 99',
          status: 'Pending',
          longurl: 'https://test.instamojo.com/@agenticpay/pr_real_123',
          created_at: '2026-10-21T09:00:00Z',
        },
      }),
    } as unknown as Response);

    const result = await client.createPaymentRequest({
      purpose: 'Order 99',
      amount: 250,
      buyerName: 'Jane Doe',
      email: 'customer@example.com',
      phone: '+919876543210',
    });

    expect(result.id).toBe('pr_real_123');
    expect(result.longurl).toContain('pr_real_123');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, opts] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://test.instamojo.com/api/1.1/payment-requests/');
    expect(opts.headers['X-Api-Key']).toBe('test_api_key');
    expect(opts.headers['X-Auth-Token']).toBe('test_auth_token');
  });

  it('throws error when remote API returns failure status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"amount":["This field is required."]}',
    } as unknown as Response);

    await expect(
      client.createPaymentRequest({
        purpose: 'Failing payment',
        amount: 0,
      })
    ).rejects.toThrow('Instamojo create payment request failed [400]');
  });

  it('handles simulated payment requests when credentials are empty', async () => {
    const unconfigured = new InstamojoClient({ apiKey: '', authToken: '' });
    const result = await unconfigured.createPaymentRequest({
      purpose: 'Dev Test',
      amount: 100,
      buyerName: 'Dev User',
    });

    expect(result.id).toMatch(/^mojo_req_/);
    expect(result.longurl).toContain('mojo_req_');
    expect(result.status).toBe('Pending');
  });

  it('creates refunds via remote API', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        refund: {
          id: 'rfnd_123',
          payment_id: 'MOJO_pay_1',
          status: 'Refunded',
          type: 'RFD',
          body: 'Customer canceled',
          refund_amount: '250.00',
          total_amount: '250.00',
          created_at: '2026-10-21T09:10:00Z',
        },
      }),
    } as unknown as Response);

    const refund = await client.createRefund({
      paymentId: 'MOJO_pay_1',
      type: 'RFD',
      body: 'Customer canceled',
      refundAmount: 250,
    });

    expect(refund.id).toBe('rfnd_123');
    expect(refund.status).toBe('Refunded');
    expect(refund.refundAmount).toBe('250.00');
  });
});

describe('InstamojoGatewayAdapter', () => {
  let adapter: InstamojoGatewayAdapter;

  beforeEach(() => {
    adapter = new InstamojoGatewayAdapter({
      enabled: true,
      priority: 1,
      maxRetries: 0,
      timeoutMs: 1000,
      healthCheckIntervalMs: 60000,
      circuitBreakerThreshold: 3,
      credentials: {},
    });
  });

  it('identifies as instamojo gateway type', () => {
    expect(adapter.getType()).toBe('instamojo');
  });

  it('processes payment requests via gateway adapter interface', async () => {
    const response = await adapter.processPayment({
      amount: '50.00',
      currency: 'INR',
      recipient: 'user_recip',
      idempotencyKey: 'idemp_mojo_1',
      metadata: {
        purpose: 'Test gateway',
      },
    });

    expect(response.success).toBe(true);
    expect(response.status).toBe('pending');
    expect(response.transactionId).toBeDefined();
    expect(adapter.getHealthStatus().isHealthy).toBe(true);
  });
});
