import Stripe from 'stripe';
import { config } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { withCircuitBreaker } from '../middleware/circuit-breaker.js';

const STRIPE_CIRCUIT_NAME = 'stripe-api';

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  const cfg = config();
  if (!cfg.STRIPE_SECRET_KEY) {
    throw new AppError(500, 'Stripe is not configured', 'STRIPE_NOT_CONFIGURED');
  }
  if (!stripeClient) {
    stripeClient = new Stripe(cfg.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
      timeout: 15_000,
      maxNetworkRetries: 2,
    });
  }
  return stripeClient;
}

// ── Payment Intents ──────────────────────────────────────────────────────────

export interface CreatePaymentIntentInput {
  amount: number;          // in smallest currency unit (cents)
  currency: string;        // e.g. 'usd'
  customerId?: string;
  metadata?: Record<string, string>;
  description?: string;
}

export async function createPaymentIntent(input: CreatePaymentIntentInput): Promise<Stripe.PaymentIntent> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.paymentIntents.create({
        amount: input.amount,
        currency: input.currency.toLowerCase(),
        customer: input.customerId,
        description: input.description,
        metadata: input.metadata ?? {},
        payment_method_types: ['card'],
      });
    },
  );
}

export async function confirmPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.paymentIntents.retrieve(paymentIntentId);
    },
  );
}

export async function cancelPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.paymentIntents.cancel(paymentIntentId);
    },
  );
}

// ── Customers ────────────────────────────────────────────────────────────────

export async function createCustomer(email: string, name?: string): Promise<Stripe.Customer> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.customers.create({ email, name });
    },
  );
}

export async function getCustomer(customerId: string): Promise<Stripe.Customer | Stripe.DeletedCustomer> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.customers.retrieve(customerId);
    },
  );
}

// ── Refunds ──────────────────────────────────────────────────────────────────

export interface CreateRefundInput {
  paymentIntentId: string;
  amount?: number;   // partial refund if provided
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
}

export async function createRefund(input: CreateRefundInput): Promise<Stripe.Refund> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.refunds.create({
        payment_intent: input.paymentIntentId,
        amount: input.amount,
        reason: input.reason ?? 'requested_by_customer',
      });
    },
  );
}

export async function getRefund(refundId: string): Promise<Stripe.Refund> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.refunds.retrieve(refundId);
    },
  );
}

// ── Disputes ─────────────────────────────────────────────────────────────────

export async function getDispute(disputeId: string): Promise<Stripe.Dispute> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.disputes.retrieve(disputeId);
    },
  );
}

export async function listDisputes(paymentIntentId?: string): Promise<Stripe.ApiList<Stripe.Dispute>> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.disputes.list(paymentIntentId ? { payment_intent: paymentIntentId } : {});
    },
  );
}

export async function submitDisputeEvidence(
  disputeId: string,
  evidence: Stripe.DisputeUpdateParams['evidence']
): Promise<Stripe.Dispute> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.disputes.update(disputeId, { evidence });
    },
  );
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

export function constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
  const cfg = config();
  if (!cfg.STRIPE_WEBHOOK_SECRET) {
    throw new AppError(500, 'Stripe webhook secret not configured', 'STRIPE_WEBHOOK_NOT_CONFIGURED');
  }
  const stripe = getStripe();
  try {
    return stripe.webhooks.constructEvent(payload, signature, cfg.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new AppError(400, 'Invalid webhook signature', 'INVALID_WEBHOOK_SIGNATURE');
  }
}

// ── Fee Tracking ─────────────────────────────────────────────────────────────

export interface FeeRecord {
  paymentIntentId: string;
  amount: number;
  currency: string;
  stripeFee: number;
  netAmount: number;
  createdAt: string;
}

// In-memory store; replace with DB in production
const feeStore = new Map<string, FeeRecord>();

export function recordFee(record: FeeRecord): void {
  feeStore.set(record.paymentIntentId, record);
}

export function getFeeRecord(paymentIntentId: string): FeeRecord | undefined {
  return feeStore.get(paymentIntentId);
}

export function listFeeRecords(): FeeRecord[] {
  return Array.from(feeStore.values());
}

/**
 * Estimate Stripe fee: 2.9% + $0.30 for US cards
 */
export function estimateStripeFee(amountCents: number): number {
  return Math.round(amountCents * 0.029 + 30);
}

// ── Subscriptions ────────────────────────────────────────────────────────────

export interface CreateSubscriptionInput {
  customerId: string;
  priceId: string;
  trialPeriodDays?: number;
  metadata?: Record<string, string>;
}

export async function createSubscription(input: CreateSubscriptionInput): Promise<Stripe.Subscription> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.subscriptions.create({
        customer: input.customerId,
        items: [{ price: input.priceId }],
        trial_period_days: input.trialPeriodDays,
        metadata: input.metadata ?? {},
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent'],
      });
    },
  );
}

export async function getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.subscriptions.retrieve(subscriptionId);
    },
  );
}

export async function updateSubscription(
  subscriptionId: string,
  params: Stripe.SubscriptionUpdateParams
): Promise<Stripe.Subscription> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.subscriptions.update(subscriptionId, params);
    },
  );
}

export async function cancelSubscription(
  subscriptionId: string,
  cancelAtPeriodEnd = false
): Promise<Stripe.Subscription> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      if (cancelAtPeriodEnd) {
        return stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        });
      }
      return stripe.subscriptions.cancel(subscriptionId);
    },
  );
}

export async function listSubscriptions(customerId?: string): Promise<Stripe.ApiList<Stripe.Subscription>> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.subscriptions.list(customerId ? { customer: customerId } : {});
    },
  );
}

// ── Prices & Products ───────────────────────────────────────────────────────

export interface CreatePriceInput {
  productId: string;
  unitAmount: number;
  currency: string;
  recurring?: {
    interval: 'day' | 'week' | 'month' | 'year';
    interval_count?: number;
  };
  metadata?: Record<string, string>;
}

export async function createPrice(input: CreatePriceInput): Promise<Stripe.Price> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.prices.create({
        product: input.productId,
        unit_amount: input.unitAmount,
        currency: input.currency.toLowerCase(),
        recurring: input.recurring,
        metadata: input.metadata ?? {},
      });
    },
  );
}

export async function getPrice(priceId: string): Promise<Stripe.Price> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.prices.retrieve(priceId);
    },
  );
}

export interface CreateProductInput {
  name: string;
  description?: string;
  metadata?: Record<string, string>;
}

export async function createProduct(input: CreateProductInput): Promise<Stripe.Product> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.products.create({
        name: input.name,
        description: input.description,
        metadata: input.metadata ?? {},
      });
    },
  );
}

// ── Usage Records (Metered Billing) ──────────────────────────────────────────

export interface RecordUsageInput {
  subscriptionItemId: string;
  quantity: number;
  timestamp?: number;
  action?: 'increment' | 'set';
}

export async function recordUsage(input: RecordUsageInput): Promise<Stripe.UsageRecord> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.subscriptionItems.createUsageRecord(
        input.subscriptionItemId,
        {
          quantity: input.quantity,
          timestamp: input.timestamp ?? Math.floor(Date.now() / 1000),
          action: input.action ?? 'increment',
        }
      );
    },
  );
}

export async function listUsageRecords(
  subscriptionItemId: string,
  limit = 100
): Promise<Stripe.ApiList<Stripe.UsageRecordSummary>> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.subscriptionItems.listUsageRecordSummaries(
        subscriptionItemId,
        { limit }
      );
    },
  );
}

// ── Invoices ─────────────────────────────────────────────────────────────────

export async function getInvoice(invoiceId: string): Promise<Stripe.Invoice> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.invoices.retrieve(invoiceId);
    },
  );
}

export async function listInvoices(customerId?: string): Promise<Stripe.ApiList<Stripe.Invoice>> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.invoices.list(customerId ? { customer: customerId } : {});
    },
  );
}

export async function payInvoice(invoiceId: string): Promise<Stripe.Invoice> {
  return withCircuitBreaker(
    STRIPE_CIRCUIT_NAME,
    async () => {
      const stripe = getStripe();
      return stripe.invoices.pay(invoiceId);
    },
  );
}
