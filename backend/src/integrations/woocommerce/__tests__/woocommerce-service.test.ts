import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WooCommerceService } from '../woocommerce-service.js';
import type { WooCommerceClient } from '../woocommerce-client.js';
import type { WooCommerceOrder } from '../types.js';

const order: WooCommerceOrder = {
  id: 1001,
  number: '1001',
  status: 'pending',
  currency: 'usd',
  total: '49.50',
  customer_id: 5,
  billing: {
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
  },
  line_items: [
    { name: 'Analytical Engine', quantity: 1, total: '49.50', price: 49.5 },
  ],
} as WooCommerceOrder;

function sign(body: string, secret = 'whsec_test'): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

describe('WooCommerceService', () => {
  let client: WooCommerceClient;
  let service: WooCommerceService;

  beforeEach(() => {
    client = {
      getOrder: vi.fn().mockResolvedValue(order),
      updateOrder: vi
        .fn()
        .mockImplementation(async (_id: number, patch: { status: string }) => ({
          ...order,
          ...patch,
        })),
      createOrderNote: vi.fn().mockResolvedValue({ id: 1 }),
    } as unknown as WooCommerceClient;

    service = new WooCommerceService(client, 'whsec_test');
  });

  it('builds a payment draft from an order', async () => {
    const draft = await service.getPaymentDraft(1001);

    expect(client.getOrder).toHaveBeenCalledWith(1001);
    expect(draft).toMatchObject({
      reference: 'wc_order_1001',
      orderId: 1001,
      amount: 49.5,
      currency: 'USD',
      description: 'WooCommerce order #1001',
      customer: {
        externalId: 'wc_customer_5',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
      },
    });
    expect(draft.lines).toEqual([
      { description: 'Analytical Engine', quantity: 1, unitAmount: 49.5 },
    ]);
  });

  it('verifies and parses a signed webhook', () => {
    const body = JSON.stringify(order);

    const event = service.processWebhook({
      rawBody: body,
      signature: sign(body),
      topic: 'order.created',
      deliveryId: 'delivery-1',
    });

    expect(event.topic).toBe('order.created');
    expect(event.deliveryId).toBe('delivery-1');
    expect(event.paymentDraft.reference).toBe('wc_order_1001');
  });

  it('rejects a webhook with an invalid signature', () => {
    const body = JSON.stringify(order);

    expect(() =>
      service.processWebhook({
        rawBody: body,
        signature: sign(body, 'wrong-secret'),
        topic: 'order.created',
      }),
    ).toThrow(/Invalid WooCommerce webhook signature/);
  });

  it('rejects an unsupported webhook topic', () => {
    const body = JSON.stringify(order);

    expect(() =>
      service.processWebhook({
        rawBody: body,
        signature: sign(body),
        topic: 'product.created',
      }),
    ).toThrow(/Invalid enum value/);
  });

  it('maps paid payments to completed orders and records a note', async () => {
    const updated = await service.syncPaymentStatus(
      1001,
      'paid',
      'tx_123',
    );

    expect(client.updateOrder).toHaveBeenCalledWith(1001, {
      status: 'completed',
    });
    expect(client.createOrderNote).toHaveBeenCalledWith(
      1001,
      'AgenticPay payment paid. Transaction: tx_123.',
    );
    expect(updated.status).toBe('completed');
  });

  it('maps failed payments to failed orders', async () => {
    await service.syncPaymentStatus(1001, 'failed');

    expect(client.updateOrder).toHaveBeenCalledWith(1001, { status: 'failed' });
  });
});
