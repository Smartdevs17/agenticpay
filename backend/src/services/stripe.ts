import Stripe from 'stripe';
import { config } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  const cfg = config();
  if (!cfg.STRIPE_SECRET_KEY) {
    throw new AppError(500, 'Stripe is not configured', 'STRIPE_NOT_CONFIGURED');
  }
  if (!stripeClient) {
    stripeClient = new Stripe(cfg.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
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
  const stripe = getStripe();
  return stripe.paymentIntents.create({
    amount: input.amount,
    currency: input.currency.toLowerCase(),
    customer: input.customerId,
    description: input.description,
    metadata: input.metadata ?? {},
    // Enable 3D Secure automatically
    payment_method_types: ['card'],
  });
}

export async function confirmPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  return stripe.paymentIntents.retrieve(paymentIntentId);
}

export async function cancelPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  return stripe.paymentIntents.cancel(paymentIntentId);
}

// ── Customers ────────────────────────────────────────────────────────────────

export async function createCustomer(email: string, name?: string): Promise<Stripe.Customer> {
  const stripe = getStripe();
  return stripe.customers.create({ email, name });
}

export async function getCustomer(customerId: string): Promise<Stripe.Customer | Stripe.DeletedCustomer> {
  const stripe = getStripe();
  return stripe.customers.retrieve(customerId);
}

// ── Refunds ──────────────────────────────────────────────────────────────────

export interface CreateRefundInput {
  paymentIntentId: string;
  amount?: number;   // partial refund if provided
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
}

export async function createRefund(input: CreateRefundInput): Promise<Stripe.Refund> {
  const stripe = getStripe();
  return stripe.refunds.create({
    payment_intent: input.paymentIntentId,
    amount: input.amount,
    reason: input.reason ?? 'requested_by_customer',
  });
}

export async function getRefund(refundId: string): Promise<Stripe.Refund> {
  const stripe = getStripe();
  return stripe.refunds.retrieve(refundId);
}

// ── Disputes ─────────────────────────────────────────────────────────────────

export async function getDispute(disputeId: string): Promise<Stripe.Dispute> {
  const stripe = getStripe();
  return stripe.disputes.retrieve(disputeId);
}

export async function listDisputes(paymentIntentId?: string): Promise<Stripe.ApiList<Stripe.Dispute>> {
  const stripe = getStripe();
  return stripe.disputes.list(paymentIntentId ? { payment_intent: paymentIntentId } : {});
}

export async function submitDisputeEvidence(
  disputeId: string,
  evidence: Stripe.DisputeUpdateParams['evidence']
): Promise<Stripe.Dispute> {
  const stripe = getStripe();
  return stripe.disputes.update(disputeId, { evidence });
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
