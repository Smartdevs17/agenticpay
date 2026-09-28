/**
 * subscription-billing.ts — Issue #914
 *
 * Subscription billing with usage metering.
 *
 * Merchants define plans with a recurring base price and an included usage
 * allowance. Customers subscribe to a plan, the platform records metered
 * usage events (idempotent on a caller supplied key), and at the end of each
 * billing period an invoice is generated that combines the base fee with
 * tiered overage charges.
 */

import { randomUUID } from 'node:crypto';
import { BaseService } from './BaseService.js';

export type BillingInterval = 'monthly' | 'annual';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled';
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void';

export interface PricingTier {
  /** Cumulative unit boundary for this tier (e.g. first 10_000 units). */
  upTo: number;
  /** Price per billable unit within this tier. */
  unitPrice: number;
}

export interface BillingPlan {
  id: string;
  name: string;
  currency: string;
  basePrice: number;
  includedUnits: number;
  overageUnitPrice: number;
  tiers?: PricingTier[];
  billingInterval: BillingInterval;
  features?: string[];
  createdAt: string;
}

export interface Subscription {
  id: string;
  merchantId: string;
  customerId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt?: string;
  cancelAtPeriodEnd: boolean;
  canceledAt?: string;
  usage: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface UsageEvent {
  id: string;
  subscriptionId: string;
  metric: string;
  quantity: number;
  idempotencyKey?: string;
  recordedAt: string;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  merchantId: string;
  customerId: string;
  planId: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  status: InvoiceStatus;
  lineItems: InvoiceLineItem[];
  baseAmount: number;
  usageAmount: number;
  total: number;
  paidAt?: string;
  createdAt: string;
}

export interface UsageSummary {
  subscriptionId: string;
  metrics: Record<string, number>;
  totalUnits: number;
  includedUnits: number;
  overageUnits: number;
  usageAmount: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVAL_DAYS: Record<BillingInterval, number> = { monthly: 30, annual: 365 };

export class SubscriptionBillingService extends BaseService {
  private plans = new Map<string, BillingPlan>();
  private subscriptions = new Map<string, Subscription>();
  private usageEvents: UsageEvent[] = [];
  private usageIdempotency = new Map<string, string>();
  private invoices = new Map<string, Invoice>();

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  // ------------------------------------------------------------------- plans

  createPlan(input: {
    id?: string;
    name: string;
    currency?: string;
    basePrice: number;
    includedUnits?: number;
    overageUnitPrice?: number;
    tiers?: PricingTier[];
    billingInterval?: BillingInterval;
    features?: string[];
  }): BillingPlan {
    this.validate(!!input.name?.trim(), 'Plan name is required');
    this.validate(input.basePrice >= 0, 'basePrice cannot be negative');
    this.validate((input.includedUnits ?? 0) >= 0, 'includedUnits cannot be negative');
    this.validate((input.overageUnitPrice ?? 0) >= 0, 'overageUnitPrice cannot be negative');

    if (input.tiers) {
      this.validate(input.tiers.length > 0, 'tiers cannot be empty');
      let previous = -1;
      for (const tier of input.tiers) {
        this.validate(tier.upTo >= 0, 'Tier upTo must be non-negative');
        this.validate(tier.unitPrice >= 0, 'Tier unitPrice cannot be negative');
        this.validate(tier.upTo > previous, 'Tiers must be sorted by ascending upTo');
        previous = tier.upTo;
      }
    }

    const plan: BillingPlan = {
      id: input.id ?? `plan_${randomUUID()}`,
      name: input.name.trim(),
      currency: (input.currency ?? 'USD').toUpperCase(),
      basePrice: this.round(input.basePrice),
      includedUnits: input.includedUnits ?? 0,
      overageUnitPrice: input.overageUnitPrice ?? 0,
      tiers: input.tiers ? [...input.tiers].sort((a, b) => a.upTo - b.upTo) : undefined,
      billingInterval: input.billingInterval ?? 'monthly',
      features: input.features,
      createdAt: new Date(this.now()).toISOString(),
    };

    this.plans.set(plan.id, plan);
    return plan;
  }

  getPlan(id: string): BillingPlan | undefined {
    return this.plans.get(id);
  }

  listPlans(): BillingPlan[] {
    return Array.from(this.plans.values());
  }

  // ----------------------------------------------------------- subscriptions

  subscribe(input: {
    merchantId: string;
    customerId: string;
    planId: string;
    trialDays?: number;
  }): Subscription {
    this.validate(!!input.merchantId, 'merchantId is required');
    this.validate(!!input.customerId, 'customerId is required');

    const plan = this.plans.get(input.planId);
    if (!plan) this.notFound('Billing plan', input.planId);

    const trialDays = input.trialDays ?? 0;
    this.validate(trialDays >= 0, 'trialDays cannot be negative');

    const start = this.now();
    const periodEnd = start + INTERVAL_DAYS[plan.billingInterval] * DAY_MS;

    const subscription: Subscription = {
      id: `sub_${randomUUID()}`,
      merchantId: input.merchantId,
      customerId: input.customerId,
      planId: plan.id,
      status: trialDays > 0 ? 'trialing' : 'active',
      currentPeriodStart: new Date(start).toISOString(),
      currentPeriodEnd: new Date(periodEnd).toISOString(),
      trialEndsAt: trialDays > 0 ? new Date(start + trialDays * DAY_MS).toISOString() : undefined,
      cancelAtPeriodEnd: false,
      usage: {},
      createdAt: new Date(start).toISOString(),
      updatedAt: new Date(start).toISOString(),
    };

    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  getSubscription(id: string): Subscription | undefined {
    return this.subscriptions.get(id);
  }

  listSubscriptions(filter: {
    merchantId?: string;
    customerId?: string;
    status?: SubscriptionStatus;
  } = {}): Subscription[] {
    return Array.from(this.subscriptions.values()).filter(
      (s) =>
        (!filter.merchantId || s.merchantId === filter.merchantId) &&
        (!filter.customerId || s.customerId === filter.customerId) &&
        (!filter.status || s.status === filter.status),
    );
  }

  cancelSubscription(id: string, options: { atPeriodEnd?: boolean } = {}): Subscription {
    const subscription = this.subscriptions.get(id);
    if (!subscription) this.notFound('Subscription', id);
    if (subscription.status === 'cancelled') {
      this.conflict('Subscription is already cancelled');
    }

    subscription.cancelAtPeriodEnd = options.atPeriodEnd === true;
    if (!subscription.cancelAtPeriodEnd) {
      subscription.status = 'cancelled';
      subscription.canceledAt = new Date(this.now()).toISOString();
    }
    subscription.updatedAt = new Date(this.now()).toISOString();
    this.subscriptions.set(id, subscription);
    return subscription;
  }

  // ---------------------------------------------------------------- metering

  recordUsage(input: {
    subscriptionId: string;
    metric: string;
    quantity: number;
    idempotencyKey?: string;
  }): UsageEvent {
    this.validate(!!input.metric?.trim(), 'metric is required');
    this.validate(input.quantity > 0, 'quantity must be greater than 0');

    const subscription = this.subscriptions.get(input.subscriptionId);
    if (!subscription) this.notFound('Subscription', input.subscriptionId);
    this.validate(
      subscription.status === 'active' || subscription.status === 'trialing',
      `Cannot meter usage for a ${subscription.status} subscription`,
    );

    if (input.idempotencyKey) {
      const existingId = this.usageIdempotency.get(input.idempotencyKey);
      if (existingId) {
        const existing = this.usageEvents.find((event) => event.id === existingId);
        if (existing) return existing;
      }
    }

    const event: UsageEvent = {
      id: `usg_${randomUUID()}`,
      subscriptionId: subscription.id,
      metric: input.metric,
      quantity: input.quantity,
      idempotencyKey: input.idempotencyKey,
      recordedAt: new Date(this.now()).toISOString(),
    };

    subscription.usage[input.metric] = (subscription.usage[input.metric] ?? 0) + input.quantity;
    subscription.updatedAt = event.recordedAt;

    this.usageEvents.push(event);
    if (input.idempotencyKey) this.usageIdempotency.set(input.idempotencyKey, event.id);
    this.subscriptions.set(subscription.id, subscription);

    return event;
  }

  listUsageEvents(subscriptionId: string): UsageEvent[] {
    return this.usageEvents.filter((event) => event.subscriptionId === subscriptionId);
  }

  getUsage(subscriptionId: string): UsageSummary {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) this.notFound('Subscription', subscriptionId);
    const plan = this.plans.get(subscription.planId);
    if (!plan) this.notFound('Billing plan', subscription.planId);

    const totalUnits = Object.values(subscription.usage).reduce((sum, qty) => sum + qty, 0);
    const overageUnits = Math.max(0, totalUnits - plan.includedUnits);

    return {
      subscriptionId: subscription.id,
      metrics: { ...subscription.usage },
      totalUnits,
      includedUnits: plan.includedUnits,
      overageUnits,
      usageAmount: this.priceOverage(plan, overageUnits),
      currency: plan.currency,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
    };
  }

  // ---------------------------------------------------------------- invoicing

  generateInvoice(subscriptionId: string): Invoice {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) this.notFound('Subscription', subscriptionId);
    const plan = this.plans.get(subscription.planId);
    if (!plan) this.notFound('Billing plan', subscription.planId);

    const totalUnits = Object.values(subscription.usage).reduce((sum, qty) => sum + qty, 0);
    const overageUnits = Math.max(0, totalUnits - plan.includedUnits);
    const usageAmount = this.priceOverage(plan, overageUnits);
    const baseAmount = plan.basePrice;

    const lineItems: InvoiceLineItem[] = [
      { description: `Base plan — ${plan.name}`, quantity: 1, unitPrice: baseAmount, amount: baseAmount },
    ];
    if (overageUnits > 0) {
      lineItems.push({
        description: 'Metered overage',
        quantity: overageUnits,
        unitPrice: this.round(usageAmount / overageUnits, 6),
        amount: usageAmount,
      });
    }

    const invoice: Invoice = {
      id: `inv_${randomUUID()}`,
      subscriptionId: subscription.id,
      merchantId: subscription.merchantId,
      customerId: subscription.customerId,
      planId: plan.id,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      currency: plan.currency,
      status: 'open',
      lineItems,
      baseAmount,
      usageAmount,
      total: this.round(baseAmount + usageAmount),
      createdAt: new Date(this.now()).toISOString(),
    };

    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  getInvoice(id: string): Invoice | undefined {
    return this.invoices.get(id);
  }

  listInvoices(filter: { subscriptionId?: string; merchantId?: string; status?: InvoiceStatus } = {}): Invoice[] {
    return Array.from(this.invoices.values()).filter(
      (invoice) =>
        (!filter.subscriptionId || invoice.subscriptionId === filter.subscriptionId) &&
        (!filter.merchantId || invoice.merchantId === filter.merchantId) &&
        (!filter.status || invoice.status === filter.status),
    );
  }

  markInvoicePaid(id: string): Invoice {
    const invoice = this.invoices.get(id);
    if (!invoice) this.notFound('Invoice', id);
    this.validate(invoice.status === 'open', `Invoice in status ${invoice.status} cannot be paid`, 'CONFLICT');

    invoice.status = 'paid';
    invoice.paidAt = new Date(this.now()).toISOString();
    this.invoices.set(id, invoice);
    return invoice;
  }

  voidInvoice(id: string): Invoice {
    const invoice = this.invoices.get(id);
    if (!invoice) this.notFound('Invoice', id);
    if (invoice.status === 'paid') this.conflict('A paid invoice cannot be voided');

    invoice.status = 'void';
    this.invoices.set(id, invoice);
    return invoice;
  }

  /**
   * Invoice the current period, roll the subscription into the next period and
   * reset metered usage counters.
   */
  closeBillingPeriod(subscriptionId: string): { invoice: Invoice; subscription: Subscription } {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) this.notFound('Subscription', subscriptionId);
    const plan = this.plans.get(subscription.planId);
    if (!plan) this.notFound('Billing plan', subscription.planId);

    const invoice = this.generateInvoice(subscriptionId);

    const periodStart = new Date(subscription.currentPeriodEnd).getTime();
    subscription.currentPeriodStart = new Date(periodStart).toISOString();
    subscription.currentPeriodEnd = new Date(
      periodStart + INTERVAL_DAYS[plan.billingInterval] * DAY_MS,
    ).toISOString();
    subscription.usage = {};
    subscription.updatedAt = new Date(this.now()).toISOString();

    if (subscription.status === 'trialing' && subscription.trialEndsAt && subscription.trialEndsAt <= invoice.periodEnd) {
      subscription.status = 'active';
    }
    if (subscription.cancelAtPeriodEnd) {
      subscription.status = 'cancelled';
      subscription.canceledAt = new Date(this.now()).toISOString();
    }

    this.subscriptions.set(subscriptionId, subscription);
    return { invoice, subscription };
  }

  resetForTests(): void {
    this.plans.clear();
    this.subscriptions.clear();
    this.usageEvents = [];
    this.usageIdempotency.clear();
    this.invoices.clear();
  }

  // --------------------------------------------------------------- internals

  /** Price overage units, honouring graduated tiers when configured. */
  private priceOverage(plan: BillingPlan, overageUnits: number): number {
    if (overageUnits <= 0) return 0;

    if (!plan.tiers || plan.tiers.length === 0) {
      return this.round(overageUnits * plan.overageUnitPrice);
    }

    let remaining = overageUnits;
    let cursor = plan.includedUnits;
    let amount = 0;

    for (const tier of plan.tiers) {
      if (remaining <= 0) break;
      if (cursor >= tier.upTo) continue;
      const span = Math.min(remaining, tier.upTo - cursor);
      amount += span * tier.unitPrice;
      remaining -= span;
      cursor += span;
    }

    // Usage beyond the last tier is charged at the plan's flat overage rate.
    if (remaining > 0) amount += remaining * plan.overageUnitPrice;

    return this.round(amount);
  }

  private round(value: number, decimals = 2): number {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }
}

export const subscriptionBillingService = new SubscriptionBillingService();
