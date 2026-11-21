import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WooCommerceClient } from '../woocommerce-client.js';

describe('WooCommerceClient', () => {
  let client: WooCommerceClient;
  const originalFetch = global.fetch;

  beforeEach(() => {
    client = new WooCommerceClient({
      storeUrl: 'https://store.example/',
      consumerKey: 'ck_test',
      consumerSecret: 'cs_test',
      timeoutMs: 1000,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches an order with basic auth from the v3 REST API', async () => {
    const order = { id: 42, status: 'pending', currency: 'USD', total: '10.00' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => order,
    } as unknown as Response);

    const result = await client.getOrder(42);

    expect(result).toEqual(order);
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://store.example/wp-json/wc/v3/orders/42');
    expect(options.method).toBe('GET');
    expect(options.headers.Authorization).toBe(
      `Basic ${Buffer.from('ck_test:cs_test').toString('base64')}`,
    );
  });

  it('updates an order status with a PUT request', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ id: 42, status: 'completed' }),
    } as unknown as Response);

    await client.updateOrder(42, { status: 'completed' });

    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://store.example/wp-json/wc/v3/orders/42');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ status: 'completed' });
  });

  it('creates an order note', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: 'Created',
      json: async () => ({ id: 7 }),
    } as unknown as Response);

    await client.createOrderNote(42, 'Payment received');

    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://store.example/wp-json/wc/v3/orders/42/notes');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      note: 'Payment received',
      customer_note: false,
    });
  });

  it('throws when the API returns an error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => '{"code":"woocommerce_rest_shop_order_invalid_id"}',
    } as unknown as Response);

    await expect(client.getOrder(999)).rejects.toThrow(/WooCommerce API error 404/);
  });

  it('accepts a valid webhook signature', () => {
    const body = JSON.stringify({ id: 42 });
    const secret = 'webhook-secret';
    const signature = createHmac('sha256', secret).update(body).digest('base64');

    expect(
      WooCommerceClient.verifyWebhookSignature(body, signature, secret),
    ).toBe(true);
  });

  it('rejects an invalid webhook signature', () => {
    const body = JSON.stringify({ id: 42 });

    expect(
      WooCommerceClient.verifyWebhookSignature(body, 'not-a-signature', 'secret'),
    ).toBe(false);
    expect(WooCommerceClient.verifyWebhookSignature(body, '', 'secret')).toBe(
      false,
    );
  });
});
