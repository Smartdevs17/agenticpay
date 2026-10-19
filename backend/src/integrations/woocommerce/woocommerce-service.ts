import { WooCommerceClient } from './woocommerce-client.js';
import {
  toPaymentDraft,
  wooCommerceOrderSchema,
  wooCommerceWebhookTopicSchema,
  type WooCommerceOrder,
  type WooCommerceOrderStatus,
  type WooCommercePaymentDraft,
  type WooCommercePaymentStatus,
  type WooCommerceWebhookEvent,
  type WooCommerceWebhookTopic,
} from './types.js';

const PAYMENT_STATUS_MAP: Record<
  WooCommercePaymentStatus,
  WooCommerceOrderStatus
> = {
  paid: 'completed',
  pending: 'processing',
  failed: 'failed',
  refunded: 'refunded',
};

export interface ProcessWebhookInput {
  rawBody: string | Buffer;
  signature: string;
  topic: string;
  deliveryId?: string;
}

/**
 * Bridges WooCommerce orders and AgenticPay payments.
 *
 * Inbound webhooks are verified before the order is normalised into a payment
 * draft. Once a payment settles, the corresponding order status is written back
 * to the store and an order note is added for merchant visibility.
 */
export class WooCommerceService {
  private client: WooCommerceClient | null = null;
  private webhookSecret?: string;

  constructor(client?: WooCommerceClient, webhookSecret?: string) {
    if (client) this.client = client;
    this.webhookSecret =
      webhookSecret ?? process.env.WOOCOMMERCE_WEBHOOK_SECRET;
  }

  getClient(): WooCommerceClient {
    if (!this.client) {
      const storeUrl = process.env.WOOCOMMERCE_STORE_URL;
      const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY;
      const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET;

      if (!storeUrl || !consumerKey || !consumerSecret) {
        throw new Error(
          'WOOCOMMERCE_STORE_URL, WOOCOMMERCE_CONSUMER_KEY and WOOCOMMERCE_CONSUMER_SECRET must be configured',
        );
      }

      this.client = new WooCommerceClient({
        storeUrl,
        consumerKey,
        consumerSecret,
      });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return Boolean(
      this.client ||
        (process.env.WOOCOMMERCE_STORE_URL &&
          process.env.WOOCOMMERCE_CONSUMER_KEY &&
          process.env.WOOCOMMERCE_CONSUMER_SECRET),
    );
  }

  /**
   * Returns the payment draft that should be sent to the AgenticPay checkout
   * for an existing order.
   */
  async getPaymentDraft(orderId: number): Promise<WooCommercePaymentDraft> {
    const order = await this.getClient().getOrder(orderId);
    return toPaymentDraft(order);
  }

  /**
   * Verifies and parses an inbound WooCommerce webhook.
   */
  processWebhook(input: ProcessWebhookInput): WooCommerceWebhookEvent {
    const secret = this.webhookSecret;
    if (!secret) {
      throw new Error('WOOCOMMERCE_WEBHOOK_SECRET is not configured');
    }

    if (
      !WooCommerceClient.verifyWebhookSignature(
        input.rawBody,
        input.signature,
        secret,
      )
    ) {
      throw new Error('Invalid WooCommerce webhook signature');
    }

    const topic = wooCommerceWebhookTopicSchema.parse(input.topic);
    const payload =
      typeof input.rawBody === 'string'
        ? input.rawBody
        : input.rawBody.toString('utf8');
    const order = wooCommerceOrderSchema.parse(JSON.parse(payload));

    return {
      topic,
      deliveryId: input.deliveryId,
      order,
      paymentDraft: toPaymentDraft(order),
    };
  }

  /**
   * Writes an AgenticPay payment status back to the WooCommerce order.
   */
  async syncPaymentStatus(
    orderId: number,
    status: WooCommercePaymentStatus,
    transactionId?: string,
  ): Promise<WooCommerceOrder> {
    const client = this.getClient();
    const orderStatus = PAYMENT_STATUS_MAP[status];
    if (!orderStatus) {
      throw new Error(`Unsupported payment status: ${status}`);
    }

    const order = await client.updateOrder(orderId, { status: orderStatus });

    const note = [
      `AgenticPay payment ${status}.`,
      transactionId ? `Transaction: ${transactionId}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    await client.createOrderNote(orderId, note);

    return order;
  }
}

export const wooCommerceService = new WooCommerceService();

export function isWooCommerceTopic(
  value: string,
): value is WooCommerceWebhookTopic {
  return wooCommerceWebhookTopicSchema.safeParse(value).success;
}
