import { z } from 'zod';

export interface WooCommerceConfig {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  timeoutMs?: number;
}

export const wooCommerceLineItemSchema = z
  .object({
    id: z.number().optional(),
    name: z.string(),
    quantity: z.number(),
    total: z.string(),
    price: z.number().optional(),
    sku: z.string().optional(),
  })
  .passthrough();

export const wooCommerceOrderSchema = z
  .object({
    id: z.number(),
    number: z.string().optional(),
    status: z.string(),
    currency: z.string().min(1),
    total: z.string(),
    customer_id: z.number().optional(),
    billing: z
      .object({
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        email: z.string().optional(),
        company: z.string().optional(),
      })
      .passthrough()
      .optional(),
    line_items: z.array(wooCommerceLineItemSchema).default([]),
    date_created: z.string().optional(),
    date_modified: z.string().optional(),
  })
  .passthrough();

export type WooCommerceOrder = z.infer<typeof wooCommerceOrderSchema>;

export const wooCommerceWebhookTopicSchema = z.enum([
  'order.created',
  'order.updated',
  'order.deleted',
]);

export type WooCommerceWebhookTopic = z.infer<
  typeof wooCommerceWebhookTopicSchema
>;

export const wooCommerceOrderStatusSchema = z.enum([
  'pending',
  'processing',
  'on-hold',
  'completed',
  'cancelled',
  'refunded',
  'failed',
]);

export type WooCommerceOrderStatus = z.infer<
  typeof wooCommerceOrderStatusSchema
>;

export const wooCommercePaymentStatusSchema = z.enum([
  'paid',
  'pending',
  'failed',
  'refunded',
]);

export type WooCommercePaymentStatus = z.infer<
  typeof wooCommercePaymentStatusSchema
>;

export const wooCommercePaymentStatusUpdateSchema = z.object({
  status: wooCommercePaymentStatusSchema,
  transactionId: z.string().max(200).optional(),
});

export type WooCommercePaymentStatusUpdateInput = z.infer<
  typeof wooCommercePaymentStatusUpdateSchema
>;

export interface WooCommercePaymentLine {
  description: string;
  quantity: number;
  unitAmount: number;
}

export interface WooCommercePaymentDraft {
  reference: string;
  orderId: number;
  amount: number;
  currency: string;
  description: string;
  customer: {
    externalId: string;
    name?: string;
    email?: string;
  };
  lines: WooCommercePaymentLine[];
  metadata: Record<string, string | number>;
}

export interface WooCommerceWebhookEvent {
  topic: WooCommerceWebhookTopic;
  deliveryId?: string;
  order: WooCommerceOrder;
  paymentDraft: WooCommercePaymentDraft;
}

export function toPaymentDraft(order: WooCommerceOrder): WooCommercePaymentDraft {
  const amount = Number(order.total);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`WooCommerce order ${order.id} has an invalid total`);
  }

  const name = [order.billing?.first_name, order.billing?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();

  return {
    reference: `wc_order_${order.id}`,
    orderId: order.id,
    amount,
    currency: order.currency.toUpperCase(),
    description: `WooCommerce order #${order.number ?? order.id}`,
    customer: {
      externalId: `wc_customer_${order.customer_id ?? 'guest'}`,
      name: name || order.billing?.company,
      email: order.billing?.email,
    },
    lines: order.line_items.map((line) => ({
      description: line.name,
      quantity: line.quantity,
      unitAmount: Number(line.price ?? 0),
    })),
    metadata: {
      source: 'woocommerce',
      orderId: order.id,
      orderNumber: order.number ?? order.id,
      status: order.status,
    },
  };
}
