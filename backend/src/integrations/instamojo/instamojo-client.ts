import { createHmac } from 'node:crypto';
import type {
  InstamojoConfig,
  InstamojoPaymentRequestInput,
  InstamojoPaymentRequestOutput,
  InstamojoPaymentDetails,
  InstamojoRefundInput,
  InstamojoRefundOutput,
  InstamojoWebhookPayload,
} from './types.js';

export class InstamojoClient {
  private apiKey: string;
  private authToken: string;
  private privateSalt: string;
  private endpointUrl: string;

  constructor(config: InstamojoConfig = {}) {
    this.apiKey = config.apiKey || process.env.INSTAMOJO_API_KEY || '';
    this.authToken = config.authToken || process.env.INSTAMOJO_AUTH_TOKEN || '';
    this.privateSalt = config.privateSalt || process.env.INSTAMOJO_PRIVATE_SALT || '';
    
    const isSandbox = config.sandbox ?? (process.env.INSTAMOJO_SANDBOX === 'true' || !process.env.INSTAMOJO_API_KEY);
    this.endpointUrl = config.endpointUrl || (isSandbox ? 'https://test.instamojo.com/api/1.1/' : 'https://www.instamojo.com/api/1.1/');
    if (!this.endpointUrl.endsWith('/')) {
      this.endpointUrl += '/';
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.authToken);
  }

  /**
   * Verify Instamojo webhook MAC signature
   * MAC calculation: sort all fields alphabetically (excluding mac), pipe-delimit values with salt
   */
  verifyWebhookMac(payload: InstamojoWebhookPayload, salt: string = this.privateSalt): boolean {
    if (!payload.mac || !salt) return false;

    const macReceived = payload.mac.toLowerCase();
    
    // Sort all payload keys alphabetically excluding 'mac'
    const sortedKeys = Object.keys(payload)
      .filter((k) => k !== 'mac' && payload[k] !== undefined)
      .sort((a, b) => a.localeCompare(b));

    const message = sortedKeys.map((k) => String(payload[k])).join('|');
    const calculatedMac = createHmac('sha1', salt).update(message).digest('hex').toLowerCase();

    return calculatedMac === macReceived;
  }

  /**
   * Create a Payment Request
   */
  async createPaymentRequest(input: InstamojoPaymentRequestInput): Promise<InstamojoPaymentRequestOutput> {
    if (!this.isConfigured()) {
      // Return simulated payment request in development / mock mode
      const simulatedId = `mojo_req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      return {
        id: simulatedId,
        amount: String(input.amount),
        purpose: input.purpose,
        status: 'Pending',
        buyerName: input.buyerName,
        email: input.email,
        phone: input.phone,
        redirectUrl: input.redirectUrl,
        webhookUrl: input.webhookUrl,
        longurl: `https://test.instamojo.com/@agenticpay/${simulatedId}`,
        createdAt: new Date().toISOString(),
      };
    }

    const bodyParams = new URLSearchParams();
    bodyParams.append('purpose', input.purpose);
    bodyParams.append('amount', String(input.amount));
    if (input.buyerName) bodyParams.append('buyer_name', input.buyerName);
    if (input.email) bodyParams.append('email', input.email);
    if (input.phone) bodyParams.append('phone', input.phone);
    if (input.redirectUrl) bodyParams.append('redirect_url', input.redirectUrl);
    if (input.webhookUrl) bodyParams.append('webhook', input.webhookUrl);
    if (input.allowRepeatedPayments !== undefined) {
      bodyParams.append('allow_repeated_payments', input.allowRepeatedPayments ? 'True' : 'False');
    }
    if (input.sendEmail !== undefined) {
      bodyParams.append('send_email', input.sendEmail ? 'True' : 'False');
    }
    if (input.sendSms !== undefined) {
      bodyParams.append('send_sms', input.sendSms ? 'True' : 'False');
    }

    const response = await fetch(`${this.endpointUrl}payment-requests/`, {
      method: 'POST',
      headers: {
        'X-Api-Key': this.apiKey,
        'X-Auth-Token': this.authToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Instamojo create payment request failed [${response.status}]: ${errText}`);
    }

    const data = await response.json() as any;
    if (!data.success) {
      throw new Error(`Instamojo error: ${JSON.stringify(data.message || data)}`);
    }

    const pr = data.payment_request;
    return {
      id: pr.id,
      phone: pr.phone,
      email: pr.email,
      buyerName: pr.buyer_name,
      amount: pr.amount,
      purpose: pr.purpose,
      status: pr.status,
      longurl: pr.longurl,
      shorturl: pr.shorturl,
      redirectUrl: pr.redirect_url,
      webhookUrl: pr.webhook,
      createdAt: pr.created_at,
      modifiedAt: pr.modified_at,
    };
  }

  /**
   * Get details of a Payment Request
   */
  async getPaymentRequest(paymentRequestId: string): Promise<InstamojoPaymentRequestOutput> {
    if (!this.isConfigured()) {
      return {
        id: paymentRequestId,
        amount: '100.00',
        purpose: 'Simulated Payment',
        status: 'Completed',
        longurl: `https://test.instamojo.com/@agenticpay/${paymentRequestId}`,
        createdAt: new Date().toISOString(),
      };
    }

    const response = await fetch(`${this.endpointUrl}payment-requests/${paymentRequestId}/`, {
      method: 'GET',
      headers: {
        'X-Api-Key': this.apiKey,
        'X-Auth-Token': this.authToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Instamojo get payment request failed with status: ${response.status}`);
    }

    const data = await response.json() as any;
    const pr = data.payment_request;
    return {
      id: pr.id,
      phone: pr.phone,
      email: pr.email,
      buyerName: pr.buyer_name,
      amount: pr.amount,
      purpose: pr.purpose,
      status: pr.status,
      longurl: pr.longurl,
      shorturl: pr.shorturl,
      redirectUrl: pr.redirect_url,
      webhookUrl: pr.webhook,
      createdAt: pr.created_at,
      modifiedAt: pr.modified_at,
    };
  }

  /**
   * Get payment details by payment ID
   */
  async getPayment(paymentId: string): Promise<InstamojoPaymentDetails> {
    if (!this.isConfigured()) {
      return {
        paymentId,
        paymentRequestId: `req_${paymentId}`,
        status: 'Credit',
        currency: 'INR',
        amount: '100.00',
        createdAt: new Date().toISOString(),
      };
    }

    const response = await fetch(`${this.endpointUrl}payments/${paymentId}/`, {
      method: 'GET',
      headers: {
        'X-Api-Key': this.apiKey,
        'X-Auth-Token': this.authToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Instamojo get payment failed with status: ${response.status}`);
    }

    const data = await response.json() as any;
    const p = data.payment;
    return {
      paymentId: p.payment_id,
      paymentRequestId: p.payment_request,
      status: p.status === 'Credit' ? 'Credit' : 'Failed',
      currency: p.currency || 'INR',
      amount: p.amount,
      buyerName: p.buyer_name,
      buyerEmail: p.buyer_email,
      buyerPhone: p.buyer_phone,
      fees: p.fees,
      mac: p.mac,
      createdAt: p.created_at,
    };
  }

  /**
   * Create a Refund
   */
  async createRefund(input: InstamojoRefundInput): Promise<InstamojoRefundOutput> {
    if (!this.isConfigured()) {
      const simulatedRefundId = `rfnd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      return {
        id: simulatedRefundId,
        paymentId: input.paymentId,
        status: 'Refunded',
        type: input.type || 'RFD',
        body: input.body,
        refundAmount: String(input.refundAmount || '100.00'),
        totalAmount: '100.00',
        createdAt: new Date().toISOString(),
      };
    }

    const bodyParams = new URLSearchParams();
    bodyParams.append('payment_id', input.paymentId);
    bodyParams.append('type', input.type);
    bodyParams.append('body', input.body);
    if (input.refundAmount !== undefined) {
      bodyParams.append('refund_amount', String(input.refundAmount));
    }

    const response = await fetch(`${this.endpointUrl}refunds/`, {
      method: 'POST',
      headers: {
        'X-Api-Key': this.apiKey,
        'X-Auth-Token': this.authToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Instamojo refund failed [${response.status}]: ${errText}`);
    }

    const data = await response.json() as any;
    const r = data.refund;
    return {
      id: r.id,
      paymentId: r.payment_id,
      status: r.status,
      type: r.type,
      body: r.body,
      refundAmount: r.refund_amount,
      totalAmount: r.total_amount,
      createdAt: r.created_at,
    };
  }
}

export const instamojoClient = new InstamojoClient();
