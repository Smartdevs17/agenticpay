import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  WooCommerceConfig,
  WooCommerceOrder,
  WooCommerceOrderStatus,
} from './types.js';

interface WooCommerceOrderPatch {
  status?: WooCommerceOrderStatus;
  customer_note?: string;
}

/**
 * Minimal WooCommerce REST API v3 client.
 *
 * Authentication uses the store's consumer key/secret pair (HTTP Basic), and
 * webhook payloads are verified with the store's webhook secret
 * (`X-WC-Webhook-Signature`).
 */
export class WooCommerceClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly timeoutMs: number;

  constructor(config: WooCommerceConfig) {
    if (!config.storeUrl) {
      throw new Error('WooCommerce storeUrl is required');
    }

    this.baseUrl = `${config.storeUrl.replace(/\/+$/, '')}/wp-json/wc/v3`;
    this.authHeader = `Basic ${Buffer.from(
      `${config.consumerKey}:${config.consumerSecret}`,
    ).toString('base64')}`;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `WooCommerce API error ${response.status}: ${response.statusText} – ${errorText}`,
      );
    }

    return (await response.json()) as T;
  }

  async getOrder(orderId: number): Promise<WooCommerceOrder> {
    return this.request<WooCommerceOrder>('GET', `/orders/${orderId}`);
  }

  async listOrders(params: {
    status?: string;
    perPage?: number;
    page?: number;
  } = {}): Promise<WooCommerceOrder[]> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.perPage) query.set('per_page', String(params.perPage));
    if (params.page) query.set('page', String(params.page));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return this.request<WooCommerceOrder[]>('GET', `/orders${suffix}`);
  }

  async updateOrder(
    orderId: number,
    patch: WooCommerceOrderPatch,
  ): Promise<WooCommerceOrder> {
    return this.request<WooCommerceOrder>('PUT', `/orders/${orderId}`, patch);
  }

  async createOrderNote(
    orderId: number,
    note: string,
    customerNote = false,
  ): Promise<{ id: number }> {
    return this.request<{ id: number }>('POST', `/orders/${orderId}/notes`, {
      note,
      customer_note: customerNote,
    });
  }

  /**
   * Verifies an `X-WC-Webhook-Signature` header. WooCommerce signs the raw
   * request body with HMAC-SHA256 and base64-encodes the digest.
   */
  static verifyWebhookSignature(
    rawBody: string | Buffer,
    signature: string,
    secret: string,
  ): boolean {
    if (!signature || !secret) return false;

    const expected = createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature.trim());

    if (expectedBuffer.length !== actualBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, actualBuffer);
  }
}
