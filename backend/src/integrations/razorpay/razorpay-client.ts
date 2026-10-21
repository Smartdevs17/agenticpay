import { createHmac } from 'node:crypto';
import type {
  RazorpayConfig,
  RazorpayOrderInput,
  RazorpayOrderOutput,
  RazorpayPaymentDetails,
  RazorpayRefundInput,
  RazorpayRefundOutput,
  RazorpayVerificationInput,
} from './types.js';

export class RazorpayClient {
  private keyId: string;
  private keySecret: string;
  private webhookSecret: string;
  private baseUrl: string;

  constructor(config: RazorpayConfig = {}) {
    this.keyId = config.keyId || process.env.RAZORPAY_KEY_ID || '';
    this.keySecret = config.keySecret || process.env.RAZORPAY_KEY_SECRET || '';
    this.webhookSecret = config.webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || '';
    this.baseUrl = config.baseUrl || 'https://api.razorpay.com/v1/';
    if (!this.baseUrl.endsWith('/')) {
      this.baseUrl += '/';
    }
  }

  isConfigured(): boolean {
    return Boolean(this.keyId && this.keySecret);
  }

  private getAuthHeader(): string {
    const creds = `${this.keyId}:${this.keySecret}`;
    return `Basic ${Buffer.from(creds).toString('base64')}`;
  }

  /**
   * Verify Razorpay Payment Signature
   * generated_signature = hmac_sha256(order_id + "|" + razorpay_payment_id, secret)
   */
  verifyPaymentSignature(
    inputOrOrderId: RazorpayVerificationInput | string,
    paymentIdOrSecret?: string,
    signature?: string,
    secretArg?: string
  ): boolean {
    let orderId: string;
    let paymentId: string;
    let sig: string;
    let secret: string;

    if (typeof inputOrOrderId === 'object') {
      orderId = inputOrOrderId.orderId;
      paymentId = inputOrOrderId.paymentId;
      sig = inputOrOrderId.signature;
      secret = paymentIdOrSecret || this.keySecret;
    } else {
      orderId = inputOrOrderId;
      paymentId = paymentIdOrSecret || '';
      sig = signature || '';
      secret = secretArg || this.keySecret;
    }

    if (!orderId || !paymentId || !sig || !secret) {
      return false;
    }
    const payload = `${orderId}|${paymentId}`;
    const expectedSignature = createHmac('sha256', secret).update(payload).digest('hex').toLowerCase();
    return expectedSignature === sig.toLowerCase();
  }

  /**
   * Verify Razorpay Webhook Signature
   * generated_signature = hmac_sha256(raw_body, webhook_secret)
   */
  verifyWebhookSignature(rawBody: string, signature: string, secret: string = this.webhookSecret): boolean {
    if (!rawBody || !signature || !secret) {
      return false;
    }
    const expectedSignature = createHmac('sha256', secret).update(rawBody).digest('hex').toLowerCase();
    return expectedSignature === signature.toLowerCase();
  }

  /**
   * Create an Order
   */
  async createOrder(input: RazorpayOrderInput): Promise<RazorpayOrderOutput> {
    if (!this.isConfigured()) {
      const simulatedId = `order_sim_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      return {
        id: simulatedId,
        entity: 'order',
        amount: input.amount,
        amountPaid: 0,
        amountDue: input.amount,
        currency: input.currency.toUpperCase(),
        receipt: input.receipt || `rcpt_${simulatedId}`,
        status: 'created',
        attempts: 0,
        notes: input.notes || {},
        createdAt: Math.floor(Date.now() / 1000),
      };
    }

    const payload = {
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      receipt: input.receipt,
      notes: input.notes,
      payment_capture: input.paymentCapture !== undefined ? input.paymentCapture : 1,
    };

    const response = await fetch(`${this.baseUrl}orders`, {
      method: 'POST',
      headers: {
        Authorization: this.getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Razorpay order creation failed (${response.status}): ${errorText}`);
    }

    const data = await response.json() as any;
    return {
      id: data.id,
      entity: 'order',
      amount: data.amount,
      amountPaid: data.amount_paid || 0,
      amountDue: data.amount_due || data.amount,
      currency: data.currency,
      receipt: data.receipt,
      status: data.status,
      attempts: data.attempts || 0,
      notes: data.notes || {},
      createdAt: data.created_at,
    };
  }

  /**
   * Fetch an Order by ID
   */
  async getOrder(orderId: string): Promise<RazorpayOrderOutput> {
    if (!this.isConfigured()) {
      return {
        id: orderId,
        entity: 'order',
        amount: 10000,
        amountPaid: 10000,
        amountDue: 0,
        currency: 'INR',
        status: 'paid',
        attempts: 1,
        notes: {},
        createdAt: Math.floor(Date.now() / 1000),
      };
    }

    const response = await fetch(`${this.baseUrl}orders/${orderId}`, {
      method: 'GET',
      headers: {
        Authorization: this.getAuthHeader(),
      },
    });

    if (!response.ok) {
      throw new Error(`Razorpay get order failed with status ${response.status}`);
    }

    const data = await response.json() as any;
    return {
      id: data.id,
      entity: 'order',
      amount: data.amount,
      amountPaid: data.amount_paid || 0,
      amountDue: data.amount_due || 0,
      currency: data.currency,
      receipt: data.receipt,
      status: data.status,
      attempts: data.attempts || 0,
      notes: data.notes || {},
      createdAt: data.created_at,
    };
  }

  /**
   * Fetch Payment details by ID
   */
  async getPayment(paymentId: string): Promise<RazorpayPaymentDetails> {
    if (!this.isConfigured()) {
      return {
        id: paymentId,
        entity: 'payment',
        amount: 10000,
        currency: 'INR',
        status: 'captured',
        orderId: `order_${paymentId}`,
        createdAt: Math.floor(Date.now() / 1000),
      };
    }

    const response = await fetch(`${this.baseUrl}payments/${paymentId}`, {
      method: 'GET',
      headers: {
        Authorization: this.getAuthHeader(),
      },
    });

    if (!response.ok) {
      throw new Error(`Razorpay get payment failed with status ${response.status}`);
    }

    const data = await response.json() as any;
    return {
      id: data.id,
      entity: 'payment',
      amount: data.amount,
      currency: data.currency,
      status: data.status,
      orderId: data.order_id,
      method: data.method,
      description: data.description,
      email: data.email,
      contact: data.contact,
      fee: data.fee,
      tax: data.tax,
      errorCode: data.error_code,
      errorDescription: data.error_description,
      createdAt: data.created_at,
    };
  }

  /**
   * Capture an authorized payment
   */
  async capturePayment(paymentId: string, amount: number, currency: string = 'INR'): Promise<RazorpayPaymentDetails> {
    if (!this.isConfigured()) {
      return {
        id: paymentId,
        entity: 'payment',
        amount,
        currency: currency.toUpperCase(),
        status: 'captured',
        createdAt: Math.floor(Date.now() / 1000),
      };
    }

    const response = await fetch(`${this.baseUrl}payments/${paymentId}/capture`, {
      method: 'POST',
      headers: {
        Authorization: this.getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount, currency: currency.toUpperCase() }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Razorpay capture payment failed [${response.status}]: ${err}`);
    }

    const data = await response.json() as any;
    return {
      id: data.id,
      entity: 'payment',
      amount: data.amount,
      currency: data.currency,
      status: data.status,
      orderId: data.order_id,
      createdAt: data.created_at,
    };
  }

  /**
   * Refund a payment
   */
  async createRefund(input: RazorpayRefundInput): Promise<RazorpayRefundOutput> {
    if (!this.isConfigured()) {
      const simulatedId = `rfnd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      return {
        id: simulatedId,
        entity: 'refund',
        amount: input.amount || 10000,
        currency: 'INR',
        paymentId: input.paymentId,
        status: 'processed',
        notes: input.notes || {},
        createdAt: Math.floor(Date.now() / 1000),
      };
    }

    const payload: Record<string, unknown> = {
      notes: input.notes,
      speed: input.speed,
    };
    if (input.amount) {
      payload.amount = input.amount;
    }

    const response = await fetch(`${this.baseUrl}payments/${input.paymentId}/refund`, {
      method: 'POST',
      headers: {
        Authorization: this.getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Razorpay refund failed [${response.status}]: ${errorText}`);
    }

    const data = await response.json() as any;
    return {
      id: data.id,
      entity: 'refund',
      amount: data.amount,
      currency: data.currency,
      paymentId: data.payment_id,
      status: data.status,
      speedProcessed: data.speed_processed,
      notes: data.notes || {},
      receipt: data.receipt,
      createdAt: data.created_at,
    };
  }
}

export const razorpayClient = new RazorpayClient();
