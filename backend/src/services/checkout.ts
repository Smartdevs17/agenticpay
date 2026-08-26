import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaseService } from './BaseService.js';
import { EmailTemplateEngine } from './email-template-engine.js';
import { EmailDeliveryService } from './email-delivery.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type CheckoutSessionStatus =
  | 'created'
  | 'payment_pending'
  | 'processing'
  | 'completed'
  | 'expired'
  | 'abandoned';

export type CheckoutPaymentMethod = 'crypto' | 'card' | 'wallet';

export interface CheckoutSession {
  id: string;
  merchantId: string;
  merchantName: string;
  amount: number;
  currency: string;
  description?: string;
  allowedMethods: CheckoutPaymentMethod[];
  selectedMethod?: CheckoutPaymentMethod;
  status: CheckoutSessionStatus;
  customerEmail?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  lockedRate?: {
    rate: number;
    lockedAt: string;
    expiresAt: string;
    pair: string;
  };
  brand?: {
    brandName: string;
    accentColor?: string;
    logoUrl?: string;
    redirectUrl?: string;
  };
  transactionId?: string;
}

export type CreateCheckoutSessionInput = {
  merchantId: string;
  amount: number;
  currency: string;
  description?: string;
  allowedMethods?: CheckoutPaymentMethod[];
  customerEmail?: string;
  brand?: {
    brandName: string;
    accentColor?: string;
    logoUrl?: string;
    redirectUrl?: string;
  };
  expiresInMinutes?: number;
};

export class CheckoutService extends BaseService {
  private sessions = new Map<string, CheckoutSession>();
  private emailTemplateEngine = new EmailTemplateEngine();
  private emailDeliveryService = new EmailDeliveryService();
  private timers = new Map<string, NodeJS.Timeout>();

  private nowIso(): string {
    return new Date().toISOString();
  }

  create(input: CreateCheckoutSessionInput): CheckoutSession {
    this.validate(input.amount > 0, 'Amount must be greater than 0');
    this.validate(!!input.merchantId, 'Merchant ID is required');

    const id = `chk_${randomUUID()}`;
    const now = new Date();
    const expiresInMin = input.expiresInMinutes || 30;
    const expiresAt = new Date(now.getTime() + expiresInMin * 60 * 1000).toISOString();

    const session: CheckoutSession = {
      id,
      merchantId: input.merchantId,
      merchantName: input.brand?.brandName || 'AgenticPay Merchant',
      amount: Number(input.amount.toFixed(2)),
      currency: input.currency.toUpperCase(),
      description: input.description,
      allowedMethods: input.allowedMethods || ['crypto', 'card', 'wallet'],
      status: 'created',
      customerEmail: input.customerEmail,
      brand: input.brand,
      expiresAt,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    this.sessions.set(id, session);

    // Schedule abandoned recovery reminder email and expiration
    this.scheduleSessionLifecycle(id, expiresInMin);

    return session;
  }

  getById(id: string): CheckoutSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    // Check if expired and update status
    const now = new Date().getTime();
    const exp = new Date(session.expiresAt).getTime();
    if (now > exp && (session.status === 'created' || session.status === 'payment_pending' || session.status === 'processing')) {
      session.status = 'expired';
      session.updatedAt = this.nowIso();
      this.sessions.set(id, session);
    }

    return session;
  }

  updatePaymentMethod(id: string, method: CheckoutPaymentMethod): CheckoutSession {
    const session = this.getById(id);
    if (!session) this.notFound('Checkout session', id);
    this.validate(session.status === 'created' || session.status === 'payment_pending', 'Session is not in payable state');
    this.validate(session.allowedMethods.includes(method), `Payment method ${method} is not allowed for this session`);

    session.selectedMethod = method;
    session.status = 'payment_pending';
    session.updatedAt = this.nowIso();
    
    this.sessions.set(id, session);
    return session;
  }

  lockExchangeRate(id: string): CheckoutSession {
    const session = this.getById(id);
    if (!session) this.notFound('Checkout session', id);
    this.validate(session.status === 'payment_pending', 'Payment method must be selected to lock rates');
    this.validate(session.selectedMethod === 'crypto', 'Rates can only be locked for crypto payments');

    const rates = this.getExchangeRates();
    const baseRate = rates[session.currency] || 1.0;
    const cryptoRate = rates['XLM'] || 0.12; // default relative to USD
    const rate = Number((baseRate / cryptoRate).toFixed(6));

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // 5 minutes rate guarantee

    session.lockedRate = {
      rate,
      lockedAt: now.toISOString(),
      expiresAt,
      pair: `XLM/${session.currency}`,
    };
    session.updatedAt = this.nowIso();

    this.sessions.set(id, session);
    return session;
  }

  async processPayment(id: string, details: { cardToken?: string; walletAddress?: string }): Promise<CheckoutSession> {
    const session = this.getById(id);
    if (!session) this.notFound('Checkout session', id);
    this.validate(session.status === 'payment_pending', 'Session is not ready for payment');
    this.validate(!!session.selectedMethod, 'No payment method selected');

    session.status = 'processing';
    session.updatedAt = this.nowIso();
    this.sessions.set(id, session);

    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Simulate random failure 5% of the time, otherwise complete
    const isSuccess = Math.random() >= 0.05;

    if (isSuccess) {
      session.status = 'completed';
      session.transactionId = `tx_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      
      // Clear timers
      this.clearTimers(id);
    } else {
      session.status = 'payment_pending'; // revert to pending
    }

    session.updatedAt = this.nowIso();
    this.sessions.set(id, session);
    return session;
  }

  expireSession(id: string): CheckoutSession {
    const session = this.sessions.get(id);
    if (!session) this.notFound('Checkout session', id);

    if (session.status === 'created' || session.status === 'payment_pending' || session.status === 'processing') {
      session.status = 'expired';
      session.updatedAt = this.nowIso();
      this.sessions.set(id, session);
    }

    this.clearTimers(id);
    return session;
  }

  async markAbandoned(id: string): Promise<CheckoutSession> {
    const session = this.sessions.get(id);
    if (!session) this.notFound('Checkout session', id);

    if (session.status === 'created' || session.status === 'payment_pending') {
      session.status = 'abandoned';
      session.updatedAt = this.nowIso();
      this.sessions.set(id, session);

      // Trigger recovery email if email is present
      if (session.customerEmail) {
        await this.sendRecoveryEmail(session);
      }
    }

    return session;
  }

  getExchangeRates(): Record<string, number> {
    return {
      USD: 1.0,
      EUR: 0.92,
      GBP: 0.79,
      XLM: 0.12,
      USDC: 1.0,
      ETH: 3500.0,
      BTC: 65000.0,
    };
  }

  generateReceipt(id: string): string {
    const session = this.getById(id);
    if (!session) this.notFound('Checkout session', id);
    this.validate(session.status === 'completed', 'Receipt is only available for completed transactions');

    const brandName = session.brand?.brandName || 'AgenticPay Merchant';
    const accentColor = session.brand?.accentColor || '#0052FF';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt for ${brandName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #333; line-height: 1.5; padding: 40px; background: #fafafa; }
    .receipt { max-width: 500px; margin: 0 auto; background: white; border: 1px solid #e1e4e8; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden; }
    .header { background: ${accentColor}; color: white; padding: 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 20px; }
    .header p { margin: 5px 0 0; opacity: 0.8; font-size: 14px; }
    .content { padding: 30px; }
    .amount { font-size: 32px; font-weight: bold; text-align: center; margin: 20px 0; color: #111; }
    .row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; border-bottom: 1px dashed #f0f0f0; padding-bottom: 12px; }
    .row:last-child { border-bottom: none; }
    .label { color: #666; }
    .value { font-weight: 600; color: #111; }
    .footer { text-align: center; font-size: 12px; color: #999; margin-top: 30px; }
    @media print {
      body { background: white; padding: 0; }
      .receipt { border: none; box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <h1>Payment Receipt</h1>
      <p>${brandName}</p>
    </div>
    <div class="content">
      <div class="amount">${new Intl.NumberFormat('en-US', { style: 'currency', currency: session.currency }).format(session.amount)}</div>
      <div class="row">
        <span class="label">Session ID</span>
        <span class="value" style="font-family: monospace;">${session.id}</span>
      </div>
      <div class="row">
        <span class="label">Transaction ID</span>
        <span class="value" style="font-family: monospace;">${session.transactionId || 'N/A'}</span>
      </div>
      <div class="row">
        <span class="label">Payment Method</span>
        <span class="value" style="text-transform: capitalize;">${session.selectedMethod || 'N/A'}</span>
      </div>
      <div class="row">
        <span class="label">Date</span>
        <span class="value">${new Date(session.updatedAt).toLocaleString()}</span>
      </div>
      <div class="row">
        <span class="label">Status</span>
        <span class="value" style="color: #2e7d32;">Success</span>
      </div>
    </div>
  </div>
  <div class="footer">
    <p>Thank you for your purchase!</p>
    <p>Secured by AgenticPay</p>
  </div>
</body>
</html>`;
  }

  private scheduleSessionLifecycle(id: string, expiresInMin: number) {
    // Schedule expiration
    const expireTimer = setTimeout(() => {
      this.expireSession(id);
    }, expiresInMin * 60 * 1000);

    // Schedule abandonment reminder 15 minutes before expiration (or 15 min from now if session is 30 min)
    const reminderDelay = Math.max(1, expiresInMin - 15) * 60 * 1000;
    const reminderTimer = setTimeout(() => {
      this.markAbandoned(id);
    }, reminderDelay);

    this.timers.set(`${id}_expire`, expireTimer);
    this.timers.set(`${id}_reminder`, reminderTimer);
  }

  private clearTimers(id: string) {
    const expireTimer = this.timers.get(`${id}_expire`);
    const reminderTimer = this.timers.get(`${id}_reminder`);

    if (expireTimer) clearTimeout(expireTimer);
    if (reminderTimer) clearTimeout(reminderTimer);

    this.timers.delete(`${id}_expire`);
    this.timers.delete(`${id}_reminder`);
  }

  private async sendRecoveryEmail(session: CheckoutSession): Promise<void> {
    try {
      const pathsToTry = [
        path.join(__dirname, '../templates/abandoned-checkout.html'),
        path.join(process.cwd(), 'backend/src/templates/abandoned-checkout.html'),
        path.join(process.cwd(), 'src/templates/abandoned-checkout.html'),
      ];

      let templateStr = '';
      for (const p of pathsToTry) {
        if (fs.existsSync(p)) {
          templateStr = fs.readFileSync(p, 'utf-8');
          break;
        }
      }

      if (!templateStr) {
        console.warn('[CheckoutService] Abandoned recovery email template not found. Using default minimal template.');
        templateStr = `
          <h2>Complete Your Purchase</h2>
          <p>Hi, you left your checkout page. Complete it here: {{checkoutUrl}}</p>
          <p>Amount: {{amount}} {{currency}}</p>
        `;
      }

      const checkoutUrl = `https://pay.agenticpay.com/checkout/${session.id}`;
      const renderedHtml = this.emailTemplateEngine.render(templateStr, {
        brand: session.brand,
        amount: session.amount,
        currency: session.currency,
        description: session.description,
        sessionId: session.id,
        checkoutUrl,
      });

      console.log(`[CheckoutService] Sending recovery email to ${session.customerEmail} for checkout ${session.id}`);

      await this.emailDeliveryService.send({
        to: session.customerEmail!,
        subject: `Complete your purchase at ${session.brand?.brandName || 'Merchant'}`,
        html: renderedHtml,
      });
    } catch (err) {
      console.error('[CheckoutService] Failed to send recovery email:', err);
    }
  }

  resetForTests(): void {
    this.sessions.clear();
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

export const checkoutService = new CheckoutService();
