/**
 * subscription-billing.ts — Issues #914, #812, #813, #814, #815
 *
 * Subscription billing with usage metering.
 *
 * Merchants define plans with a recurring base price and an included usage
 * allowance. Customers subscribe to a plan, the platform records metered
 * usage events (idempotent on a caller supplied key), and at the end of each
 * billing period an invoice is generated that combines the base fee with
 * tiered overage charges.
 *
 * On top of that core:
 * - #815 plans can attach per-metric metered prices (per-unit, package,
 *   graduated or volume pricing with sum/max/last aggregation).
 * - #812 mid-cycle plan changes are prorated across the billing period.
 * - #814 promo codes grant percentage or fixed discounts for one, several or
 *   all billing periods.
 * - #813 failed invoice payments enter dunning and are retried on a
 *   merchant-configurable schedule before a final action is taken.
 */

import { randomUUID } from 'node:crypto';
import { BaseService } from './BaseService.js';
import { roundMoney } from './billing/money.js';
import {
  MeterCharge,
  MeterReading,
  MeteredPrice,
  MeterAggregation,
  MeteredPricingModel,
  MeterTier,
  aggregateReading,
  applyReading,
  priceMeteredUsage,
  validateMeteredPrice,
} from './billing/metered-pricing.js';
import {
  PRORATION_BEHAVIORS,
  PlanSegment,
  ProrationBehavior,
  ProrationQuote,
  quoteProration,
  segmentShares,
} from './billing/proration.js';
import {
  AppliedDiscount,
  PromoCode,
  PromoCodeInput,
  discountAmount,
  isDiscountActive,
  normalizeCode,
  redemptionError,
  toAppliedDiscount,
  validatePromoCodeInput,
} from './billing/discounts.js';
import {
  DEFAULT_FINAL_ACTION,
  DEFAULT_RETRY_SCHEDULE_DAYS,
  DunningConfig,
  DunningFinalAction,
  DunningState,
  DunningStatus,
  nextRetryAt,
  validateRetrySchedule,
} from './billing/dunning.js';

export type { MeterCharge, MeterReading, MeteredPrice, MeterTier } from './billing/metered-pricing.js';
export type { PlanSegment, ProrationBehavior, ProrationQuote } from './billing/proration.js';
export type { AppliedDiscount, PromoCode, PromoCodeInput } from './billing/discounts.js';
export type { DunningConfig, DunningFinalAction, DunningState, DunningStatus } from './billing/dunning.js';

export type BillingInterval = 'monthly' | 'annual';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled';
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
export type InvoiceKind = 'period' | 'plan_change';

export interface PricingTier {
  /** Cumulative unit boundary for this tier (e.g. first 10_000 units). */
  upTo: number;
  /** Price per billable unit within this tier. */
  unitPrice: number;
}

export interface MeteredPriceInput {
  metric: string;
  displayName?: string;
  aggregation?: MeterAggregation;
  model: MeteredPricingModel;
  includedUnits?: number;
  unitPrice?: number;
  packageSize?: number;
  packagePrice?: number;
  tiers?: MeterTier[];
}

export interface BillingPlan {
  id: string;
  name: string;
  currency: string;
  basePrice: number;
  includedUnits: number;
  overageUnitPrice: number;
  tiers?: PricingTier[];
  /** Per-metric usage pricing (#815). When set, it replaces the plan-wide overage model. */
  meters?: MeteredPrice[];
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
  /** Running aggregates per metric for the current period (#815). */
  meterReadings: Record<string, MeterReading>;
  /** Plans in effect during the current period, used for proration (#812). */
  planSegments: PlanSegment[];
  /** Discount granted by a redeemed promo code (#814). */
  discount?: AppliedDiscount;
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
  kind: InvoiceKind;
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
  subtotal: number;
  discountAmount: number;
  discountCode?: string;
  total: number;
  dunning?: DunningState;
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
  /** Per-meter breakdown, present when the plan uses metered prices. */
  meters?: MeterCharge[];
  currency: string;
  periodStart: string;
  periodEnd: string;
}

export interface PlanChangePreview extends ProrationQuote {
  subscriptionId: string;
  currentPlanId: string;
  newPlanId: string;
  currency: string;
  changeAt: string;
  intervalChange: boolean;
}

export interface PlanChangeResult {
  subscription: Subscription;
  proration: PlanChangePreview | null;
  /** Invoice raised immediately for `always_invoice` or billing interval changes. */
  invoice?: Invoice;
}

export interface PromoCodeValidation {
  valid: boolean;
  reason?: string;
  promoCode?: PromoCode;
  /** Discount the code would grant on the plan's base price. */
  estimatedDiscount?: number;
}

export interface PromoRedemption {
  promoCodeId: string;
  customerId: string;
  subscriptionId: string;
  redeemedAt: string;
}

export interface PaymentAttemptResult {
  success: boolean;
  failureReason?: string;
}

export type PaymentAttempter = (
  invoice: Invoice,
) => PaymentAttemptResult | Promise<PaymentAttemptResult>;

export interface DunningRunResult {
  processed: number;
  recovered: string[];
  failed: string[];
  exhausted: string[];
}

interface UsageCharges {
  totalUnits: number;
  includedUnits: number;
  overageUnits: number;
  usageAmount: number;
  meters?: MeterCharge[];
  lineItems: InvoiceLineItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVAL_DAYS: Record<BillingInterval, number> = { monthly: 30, annual: 365 };

export class SubscriptionBillingService extends BaseService {
  private plans = new Map<string, BillingPlan>();
  private subscriptions = new Map<string, Subscription>();
  private usageEvents: UsageEvent[] = [];
  private usageIdempotency = new Map<string, string>();
  private invoices = new Map<string, Invoice>();
  private promoCodes = new Map<string, PromoCode>();
  private promoCodeIds = new Map<string, string>();
  private promoRedemptions: PromoRedemption[] = [];
  private dunningConfigs = new Map<string, DunningConfig>();
  private paymentAttempter?: PaymentAttempter;

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
    meters?: MeteredPriceInput[];
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

    let meters: MeteredPrice[] | undefined;
    if (input.meters) {
      this.validate(input.meters.length > 0, 'meters cannot be empty');
      meters = input.meters.map((meter) => ({
        ...meter,
        metric: meter.metric?.trim(),
        aggregation: meter.aggregation ?? 'sum',
        includedUnits: meter.includedUnits ?? 0,
      }));
      const seen = new Set<string>();
      for (const meter of meters) {
        const error = validateMeteredPrice(meter);
        this.validate(error === null, error ?? '');
        this.validate(!seen.has(meter.metric), `Duplicate meter for metric ${meter.metric}`);
        seen.add(meter.metric);
      }
    }

    const plan: BillingPlan = {
      id: input.id ?? `plan_${randomUUID()}`,
      name: input.name.trim(),
      currency: (input.currency ?? 'USD').toUpperCase(),
      basePrice: roundMoney(input.basePrice),
      includedUnits: input.includedUnits ?? 0,
      overageUnitPrice: input.overageUnitPrice ?? 0,
      tiers: input.tiers ? [...input.tiers].sort((a, b) => a.upTo - b.upTo) : undefined,
      meters,
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
    promoCode?: string;
  }): Subscription {
    this.validate(!!input.merchantId, 'merchantId is required');
    this.validate(!!input.customerId, 'customerId is required');

    const plan = this.plans.get(input.planId);
    if (!plan) this.notFound('Billing plan', input.planId);

    const trialDays = input.trialDays ?? 0;
    this.validate(trialDays >= 0, 'trialDays cannot be negative');

    // Resolve the promo code before creating anything so a bad code has no side effects.
    const promo = input.promoCode
      ? this.requireRedeemable(input.promoCode, {
          merchantId: input.merchantId,
          customerId: input.customerId,
          plan,
        })
      : undefined;

    const start = this.now();
    const periodEnd = start + INTERVAL_DAYS[plan.billingInterval] * DAY_MS;
    const periodStart = new Date(start).toISOString();

    const subscription: Subscription = {
      id: `sub_${randomUUID()}`,
      merchantId: input.merchantId,
      customerId: input.customerId,
      planId: plan.id,
      status: trialDays > 0 ? 'trialing' : 'active',
      currentPeriodStart: periodStart,
      currentPeriodEnd: new Date(periodEnd).toISOString(),
      trialEndsAt: trialDays > 0 ? new Date(start + trialDays * DAY_MS).toISOString() : undefined,
      cancelAtPeriodEnd: false,
      usage: {},
      meterReadings: {},
      planSegments: [{ planId: plan.id, startedAt: periodStart }],
      createdAt: periodStart,
      updatedAt: periodStart,
    };

    this.subscriptions.set(subscription.id, subscription);
    if (promo) this.redeem(subscription, promo);
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

  // ------------------------------------------------------ plan changes (#812)

  /** Quote the proration for moving a subscription to another plan right now. */
  previewPlanChange(subscriptionId: string, planId: string): PlanChangePreview {
    const { subscription, currentPlan, newPlan } = this.resolvePlanChange(subscriptionId, planId);
    return this.buildPlanChangePreview(subscription, currentPlan, newPlan);
  }

  /**
   * Move a subscription to another plan mid-cycle.
   *
   * - `create_prorations` (default): the period is split between the plans and
   *   each is charged for the share it covered on the closing invoice.
   * - `always_invoice`: the time used on the old plan (and its metered usage)
   *   is invoiced immediately; the rest of the period is billed on the new plan.
   * - `none`: no proration, the whole period is billed on the new plan.
   *
   * Changing the billing interval always settles the current period
   * immediately and starts a fresh period on the new plan.
   */
  changePlan(
    subscriptionId: string,
    input: { planId: string; prorationBehavior?: ProrationBehavior },
  ): PlanChangeResult {
    const behavior = input.prorationBehavior ?? 'create_prorations';
    this.validate(PRORATION_BEHAVIORS.includes(behavior), `Unknown prorationBehavior ${behavior}`);

    const { subscription, currentPlan, newPlan } = this.resolvePlanChange(subscriptionId, input.planId);
    const now = this.now();
    const nowIso = new Date(now).toISOString();
    const intervalChange = currentPlan.billingInterval !== newPlan.billingInterval;

    // Nothing has been consumed during a trial, so the switch is free.
    if (subscription.status === 'trialing') {
      subscription.planId = newPlan.id;
      subscription.planSegments = [{ planId: newPlan.id, startedAt: subscription.currentPeriodStart }];
      if (intervalChange) {
        subscription.currentPeriodEnd = new Date(
          new Date(subscription.currentPeriodStart).getTime() + INTERVAL_DAYS[newPlan.billingInterval] * DAY_MS,
        ).toISOString();
      }
      subscription.updatedAt = nowIso;
      return { subscription, proration: null };
    }

    this.validate(
      !(intervalChange && behavior === 'none'),
      'Changing billing interval requires proration (create_prorations or always_invoice)',
    );

    const proration =
      behavior === 'none' ? null : this.buildPlanChangePreview(subscription, currentPlan, newPlan);

    let invoice: Invoice | undefined;
    if (intervalChange || behavior === 'always_invoice') {
      invoice = this.createInvoice(subscription, currentPlan, 'plan_change', now);
      subscription.usage = {};
      subscription.meterReadings = {};

      if (intervalChange) {
        subscription.currentPeriodStart = nowIso;
        subscription.currentPeriodEnd = new Date(
          now + INTERVAL_DAYS[newPlan.billingInterval] * DAY_MS,
        ).toISOString();
        this.consumeDiscountPeriod(subscription);
      }
      subscription.planSegments = [{ planId: newPlan.id, startedAt: nowIso }];
    } else if (behavior === 'create_prorations') {
      subscription.planSegments.push({ planId: newPlan.id, startedAt: nowIso });
    } else {
      subscription.planSegments = [{ planId: newPlan.id, startedAt: subscription.currentPeriodStart }];
    }

    subscription.planId = newPlan.id;
    subscription.updatedAt = nowIso;
    this.subscriptions.set(subscription.id, subscription);

    return { subscription, proration, invoice };
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
    // Past-due subscriptions keep receiving service while dunning runs, so keep metering them.
    this.validate(
      subscription.status !== 'cancelled',
      `Cannot meter usage for a ${subscription.status} subscription`,
    );

    if (input.idempotencyKey) {
      const existingId = this.usageIdempotency.get(input.idempotencyKey);
      if (existingId) {
        const existing = this.usageEvents.find((event) => event.id === existingId);
        if (existing) return existing;
      }
    }

    const plan = this.plans.get(subscription.planId);
    if (plan?.meters) {
      this.validate(
        plan.meters.some((meter) => meter.metric === input.metric),
        `Metric ${input.metric} is not metered on plan ${plan.id}`,
      );
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
    subscription.meterReadings[input.metric] = applyReading(
      subscription.meterReadings[input.metric],
      input.quantity,
    );
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

    const charges = this.computeUsageCharges(subscription, plan);

    return {
      subscriptionId: subscription.id,
      metrics: { ...subscription.usage },
      totalUnits: charges.totalUnits,
      includedUnits: charges.includedUnits,
      overageUnits: charges.overageUnits,
      usageAmount: charges.usageAmount,
      meters: charges.meters,
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

    return this.createInvoice(subscription, plan, 'period');
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
    this.validate(
      invoice.status === 'open' || invoice.status === 'uncollectible',
      `Invoice in status ${invoice.status} cannot be paid`,
      'CONFLICT',
    );

    const nowIso = new Date(this.now()).toISOString();
    invoice.status = 'paid';
    invoice.paidAt = nowIso;
    if (invoice.dunning?.status === 'retrying') {
      invoice.dunning.status = 'recovered';
      invoice.dunning.nextRetryAt = undefined;
      invoice.dunning.endedAt = nowIso;
    }
    this.invoices.set(id, invoice);
    this.reactivateIfSettled(invoice.subscriptionId);
    return invoice;
  }

  voidInvoice(id: string): Invoice {
    const invoice = this.invoices.get(id);
    if (!invoice) this.notFound('Invoice', id);
    if (invoice.status === 'paid') this.conflict('A paid invoice cannot be voided');

    invoice.status = 'void';
    if (invoice.dunning?.status === 'retrying') {
      invoice.dunning.status = 'stopped';
      invoice.dunning.nextRetryAt = undefined;
      invoice.dunning.endedAt = new Date(this.now()).toISOString();
    }
    this.invoices.set(id, invoice);
    this.reactivateIfSettled(invoice.subscriptionId);
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
    subscription.meterReadings = {};
    subscription.planSegments = [{ planId: plan.id, startedAt: subscription.currentPeriodStart }];
    subscription.updatedAt = new Date(this.now()).toISOString();
    this.consumeDiscountPeriod(subscription);

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

  // ------------------------------------------------------ promo codes (#814)

  createPromoCode(input: PromoCodeInput): PromoCode {
    const error = validatePromoCodeInput(input);
    this.validate(error === null, error ?? '');

    const code = normalizeCode(input.code);
    if (this.promoCodeIds.has(code)) this.conflict(`Promo code ${code} already exists`);
    for (const planId of input.appliesToPlanIds ?? []) {
      if (!this.plans.has(planId)) this.notFound('Billing plan', planId);
    }

    const promo: PromoCode = {
      id: `promo_${randomUUID()}`,
      code,
      description: input.description,
      merchantId: input.merchantId,
      discountType: input.discountType,
      percentOff: input.percentOff,
      amountOff: input.amountOff !== undefined ? roundMoney(input.amountOff) : undefined,
      currency: input.currency?.toUpperCase(),
      duration: input.duration ?? 'once',
      durationInPeriods: input.durationInPeriods,
      maxRedemptions: input.maxRedemptions,
      perCustomerLimit: input.perCustomerLimit ?? 1,
      appliesToPlanIds: input.appliesToPlanIds,
      minimumAmount: input.minimumAmount,
      startsAt: input.startsAt ? new Date(input.startsAt).toISOString() : undefined,
      expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : undefined,
      active: true,
      timesRedeemed: 0,
      createdAt: new Date(this.now()).toISOString(),
    };

    this.promoCodes.set(promo.id, promo);
    this.promoCodeIds.set(code, promo.id);
    return promo;
  }

  /** Look up a promo code by id or (case-insensitive) code. */
  getPromoCode(idOrCode: string): PromoCode | undefined {
    const byId = this.promoCodes.get(idOrCode);
    if (byId) return byId;
    const id = this.promoCodeIds.get(normalizeCode(idOrCode));
    return id ? this.promoCodes.get(id) : undefined;
  }

  listPromoCodes(filter: { merchantId?: string; active?: boolean } = {}): PromoCode[] {
    return Array.from(this.promoCodes.values()).filter(
      (promo) =>
        (!filter.merchantId || promo.merchantId === filter.merchantId) &&
        (filter.active === undefined || promo.active === filter.active),
    );
  }

  deactivatePromoCode(idOrCode: string): PromoCode {
    const promo = this.getPromoCode(idOrCode);
    if (!promo) this.notFound('Promo code', idOrCode);
    promo.active = false;
    return promo;
  }

  /** Check whether a code can be redeemed without redeeming it. */
  validatePromoCode(input: {
    code: string;
    merchantId: string;
    customerId: string;
    planId: string;
  }): PromoCodeValidation {
    const plan = this.plans.get(input.planId);
    if (!plan) this.notFound('Billing plan', input.planId);

    const promo = this.getPromoCode(input.code);
    if (!promo) return { valid: false, reason: 'Promo code not found' };

    const reason = redemptionError(promo, this.redemptionContext(promo, input.merchantId, input.customerId, plan));
    if (reason) return { valid: false, reason, promoCode: promo };

    return { valid: true, promoCode: promo, estimatedDiscount: discountAmount(promo, plan.basePrice) };
  }

  applyPromoCode(subscriptionId: string, code: string): Subscription {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) this.notFound('Subscription', subscriptionId);
    if (subscription.status === 'cancelled') this.conflict('Cannot apply a promo code to a cancelled subscription');
    if (isDiscountActive(subscription.discount)) {
      this.conflict('Subscription already has an active discount; remove it first');
    }
    const plan = this.plans.get(subscription.planId);
    if (!plan) this.notFound('Billing plan', subscription.planId);

    const promo = this.requireRedeemable(code, {
      merchantId: subscription.merchantId,
      customerId: subscription.customerId,
      plan,
    });
    this.redeem(subscription, promo);
    return subscription;
  }

  removeDiscount(subscriptionId: string): Subscription {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) this.notFound('Subscription', subscriptionId);
    if (!subscription.discount) this.notFound('Discount on subscription', subscriptionId);

    subscription.discount = undefined;
    subscription.updatedAt = new Date(this.now()).toISOString();
    return subscription;
  }

  listPromoRedemptions(promoCodeId: string): PromoRedemption[] {
    return this.promoRedemptions.filter((r) => r.promoCodeId === promoCodeId);
  }

  // ---------------------------------------------------------- dunning (#813)

  configureDunning(
    merchantId: string,
    input: { retryScheduleDays?: number[]; finalAction?: DunningFinalAction },
  ): DunningConfig {
    this.validate(!!merchantId, 'merchantId is required');
    const current = this.getDunningConfig(merchantId);

    const retryScheduleDays = input.retryScheduleDays ?? current.retryScheduleDays;
    const scheduleError = validateRetrySchedule(retryScheduleDays);
    this.validate(scheduleError === null, scheduleError ?? '');

    const finalAction = input.finalAction ?? current.finalAction;
    this.validate(
      finalAction === 'cancel_subscription' || finalAction === 'mark_uncollectible',
      `Unknown finalAction ${String(finalAction)}`,
    );

    const config: DunningConfig = {
      merchantId,
      retryScheduleDays: [...retryScheduleDays],
      finalAction,
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.dunningConfigs.set(merchantId, config);
    return config;
  }

  getDunningConfig(merchantId: string): DunningConfig {
    return (
      this.dunningConfigs.get(merchantId) ?? {
        merchantId,
        retryScheduleDays: [...DEFAULT_RETRY_SCHEDULE_DAYS],
        finalAction: DEFAULT_FINAL_ACTION,
      }
    );
  }

  /** Register the function used by `processDunning` to retry a charge. */
  setPaymentAttempter(attempter: PaymentAttempter | undefined): void {
    this.paymentAttempter = attempter;
  }

  /**
   * Record the outcome of a collection attempt for an open invoice. The first
   * failure starts dunning and moves the subscription to `past_due`; later
   * failures advance the retry schedule until it is exhausted.
   */
  recordPaymentAttempt(invoiceId: string, result: PaymentAttemptResult): Invoice {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) this.notFound('Invoice', invoiceId);
    if (invoice.status !== 'open') {
      this.conflict(`Cannot record a payment attempt for a ${invoice.status} invoice`);
    }

    const now = this.now();
    const nowIso = new Date(now).toISOString();
    const dunning = invoice.dunning?.status === 'retrying' ? invoice.dunning : undefined;

    if (result.success) {
      if (dunning) {
        dunning.retriesAttempted += 1;
        dunning.history.push({ attempt: dunning.retriesAttempted, attemptedAt: nowIso, success: true });
      }
      return this.markInvoicePaid(invoiceId);
    }

    const subscription = this.subscriptions.get(invoice.subscriptionId);

    if (!dunning) {
      const config = this.getDunningConfig(invoice.merchantId);
      invoice.dunning = {
        status: 'retrying',
        startedAt: nowIso,
        retryScheduleDays: [...config.retryScheduleDays],
        finalAction: config.finalAction,
        retriesAttempted: 0,
        nextRetryAt: new Date(nextRetryAt(now, config.retryScheduleDays, 0)!).toISOString(),
        history: [{ attempt: 0, attemptedAt: nowIso, success: false, failureReason: result.failureReason }],
      };
      if (subscription && (subscription.status === 'active' || subscription.status === 'trialing')) {
        subscription.status = 'past_due';
        subscription.updatedAt = nowIso;
      }
      return invoice;
    }

    dunning.retriesAttempted += 1;
    dunning.history.push({
      attempt: dunning.retriesAttempted,
      attemptedAt: nowIso,
      success: false,
      failureReason: result.failureReason,
    });

    const next = nextRetryAt(new Date(dunning.startedAt).getTime(), dunning.retryScheduleDays, dunning.retriesAttempted);
    if (next !== undefined) {
      dunning.nextRetryAt = new Date(next).toISOString();
      return invoice;
    }

    dunning.status = 'exhausted';
    dunning.nextRetryAt = undefined;
    dunning.endedAt = nowIso;
    invoice.status = 'uncollectible';
    if (dunning.finalAction === 'cancel_subscription' && subscription && subscription.status !== 'cancelled') {
      subscription.status = 'cancelled';
      subscription.canceledAt = nowIso;
      subscription.updatedAt = nowIso;
    }
    return invoice;
  }

  /** Invoices currently (or previously) in dunning. */
  listDunningInvoices(filter: { merchantId?: string; status?: DunningStatus } = {}): Invoice[] {
    return Array.from(this.invoices.values()).filter(
      (invoice) =>
        !!invoice.dunning &&
        (!filter.merchantId || invoice.merchantId === filter.merchantId) &&
        (!filter.status || invoice.dunning.status === filter.status),
    );
  }

  /** Retry every invoice whose next scheduled retry is due. */
  async processDunning(attempter: PaymentAttempter | undefined = this.paymentAttempter): Promise<DunningRunResult> {
    if (!attempter) this.conflict('No payment attempter is configured for dunning retries');

    const now = this.now();
    const due = this.listDunningInvoices({ status: 'retrying' }).filter((invoice) => {
      const retryAt = invoice.dunning?.nextRetryAt;
      return invoice.status === 'open' && retryAt !== undefined && new Date(retryAt).getTime() <= now;
    });

    const result: DunningRunResult = { processed: 0, recovered: [], failed: [], exhausted: [] };
    for (const invoice of due) {
      let outcome: PaymentAttemptResult;
      try {
        outcome = await attempter(invoice);
      } catch (err) {
        outcome = { success: false, failureReason: err instanceof Error ? err.message : 'Payment attempt failed' };
      }

      const updated = this.recordPaymentAttempt(invoice.id, outcome);
      result.processed += 1;
      if (updated.status === 'paid') result.recovered.push(updated.id);
      else if (updated.dunning?.status === 'exhausted') result.exhausted.push(updated.id);
      else result.failed.push(updated.id);
    }
    return result;
  }

  resetForTests(): void {
    this.plans.clear();
    this.subscriptions.clear();
    this.usageEvents = [];
    this.usageIdempotency.clear();
    this.invoices.clear();
    this.promoCodes.clear();
    this.promoCodeIds.clear();
    this.promoRedemptions = [];
    this.dunningConfigs.clear();
    this.paymentAttempter = undefined;
  }

  // --------------------------------------------------------------- internals

  /**
   * Build and store an invoice for `subscription`. Base charges cover the plan
   * segments up to `until` (the period end by default); usage is priced with
   * `usagePlan`.
   */
  private createInvoice(
    subscription: Subscription,
    usagePlan: BillingPlan,
    kind: InvoiceKind,
    until?: number,
  ): Invoice {
    const periodStartMs = new Date(subscription.currentPeriodStart).getTime();
    const periodEndMs = new Date(subscription.currentPeriodEnd).getTime();
    const invoiceEndMs = Math.min(until ?? periodEndMs, periodEndMs);

    const lineItems: InvoiceLineItem[] = [];
    let baseAmount = 0;
    for (const share of segmentShares(subscription.planSegments, periodStartMs, periodEndMs, invoiceEndMs)) {
      const plan = this.plans.get(share.planId);
      if (!plan) this.notFound('Billing plan', share.planId);

      if (share.fraction >= 1) {
        lineItems.push({
          description: `Base plan — ${plan.name}`,
          quantity: 1,
          unitPrice: plan.basePrice,
          amount: plan.basePrice,
        });
        baseAmount += plan.basePrice;
      } else {
        const amount = roundMoney(plan.basePrice * share.fraction);
        const percent = roundMoney(share.fraction * 100);
        lineItems.push({
          description: `Base plan — ${plan.name} (prorated, ${percent}% of period)`,
          quantity: roundMoney(share.fraction, 6),
          unitPrice: plan.basePrice,
          amount,
        });
        baseAmount += amount;
      }
    }
    baseAmount = roundMoney(baseAmount);

    const usage = this.computeUsageCharges(subscription, usagePlan);
    lineItems.push(...usage.lineItems);

    const subtotal = roundMoney(baseAmount + usage.usageAmount);
    let discount = 0;
    let discountCode: string | undefined;
    if (isDiscountActive(subscription.discount)) {
      discount = discountAmount(subscription.discount, subtotal);
      if (discount > 0) {
        discountCode = subscription.discount.code;
        lineItems.push({
          description: `Discount — ${subscription.discount.code}`,
          quantity: 1,
          unitPrice: -discount,
          amount: -discount,
        });
      }
    }

    const invoice: Invoice = {
      id: `inv_${randomUUID()}`,
      kind,
      subscriptionId: subscription.id,
      merchantId: subscription.merchantId,
      customerId: subscription.customerId,
      planId: usagePlan.id,
      periodStart: subscription.currentPeriodStart,
      periodEnd: new Date(invoiceEndMs).toISOString(),
      currency: usagePlan.currency,
      status: 'open',
      lineItems,
      baseAmount,
      usageAmount: usage.usageAmount,
      subtotal,
      discountAmount: discount,
      discountCode,
      total: roundMoney(subtotal - discount),
      createdAt: new Date(this.now()).toISOString(),
    };

    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  private computeUsageCharges(subscription: Subscription, plan: BillingPlan): UsageCharges {
    if (plan.meters && plan.meters.length > 0) {
      const meters = plan.meters.map((meter) =>
        priceMeteredUsage(meter, aggregateReading(subscription.meterReadings[meter.metric], meter.aggregation)),
      );
      return {
        totalUnits: meters.reduce((sum, m) => sum + m.quantity, 0),
        includedUnits: meters.reduce((sum, m) => sum + m.includedUnits, 0),
        overageUnits: meters.reduce((sum, m) => sum + m.billableUnits, 0),
        usageAmount: roundMoney(meters.reduce((sum, m) => sum + m.amount, 0)),
        meters,
        lineItems: meters
          .filter((m) => m.amount > 0)
          .map((m) => ({
            description: m.description,
            quantity: m.billableUnits,
            unitPrice: roundMoney(m.amount / m.billableUnits, 6),
            amount: m.amount,
          })),
      };
    }

    const totalUnits = Object.values(subscription.usage).reduce((sum, qty) => sum + qty, 0);
    const overageUnits = Math.max(0, totalUnits - plan.includedUnits);
    const usageAmount = this.priceOverage(plan, overageUnits);

    return {
      totalUnits,
      includedUnits: plan.includedUnits,
      overageUnits,
      usageAmount,
      lineItems:
        overageUnits > 0
          ? [
              {
                description: 'Metered overage',
                quantity: overageUnits,
                unitPrice: roundMoney(usageAmount / overageUnits, 6),
                amount: usageAmount,
              },
            ]
          : [],
    };
  }

  /** Price overage units, honouring graduated tiers when configured. */
  private priceOverage(plan: BillingPlan, overageUnits: number): number {
    if (overageUnits <= 0) return 0;

    if (!plan.tiers || plan.tiers.length === 0) {
      return roundMoney(overageUnits * plan.overageUnitPrice);
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

    return roundMoney(amount);
  }

  private resolvePlanChange(subscriptionId: string, planId: string) {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) this.notFound('Subscription', subscriptionId);
    if (subscription.status === 'cancelled') this.conflict('Cannot change the plan of a cancelled subscription');

    const currentPlan = this.plans.get(subscription.planId);
    if (!currentPlan) this.notFound('Billing plan', subscription.planId);
    const newPlan = this.plans.get(planId);
    if (!newPlan) this.notFound('Billing plan', planId);

    if (newPlan.id === currentPlan.id) this.conflict('Subscription is already on this plan');
    this.validate(
      newPlan.currency === currentPlan.currency,
      `Cannot change from a ${currentPlan.currency} plan to a ${newPlan.currency} plan`,
    );

    return { subscription, currentPlan, newPlan };
  }

  private buildPlanChangePreview(
    subscription: Subscription,
    currentPlan: BillingPlan,
    newPlan: BillingPlan,
  ): PlanChangePreview {
    const now = this.now();
    const quote = quoteProration({
      currentPrice: currentPlan.basePrice,
      newPrice: newPlan.basePrice,
      periodStart: new Date(subscription.currentPeriodStart).getTime(),
      periodEnd: new Date(subscription.currentPeriodEnd).getTime(),
      changeAt: now,
    });

    return {
      subscriptionId: subscription.id,
      currentPlanId: currentPlan.id,
      newPlanId: newPlan.id,
      currency: currentPlan.currency,
      changeAt: new Date(now).toISOString(),
      intervalChange: currentPlan.billingInterval !== newPlan.billingInterval,
      ...quote,
    };
  }

  private redemptionContext(promo: PromoCode, merchantId: string, customerId: string, plan: BillingPlan) {
    return {
      now: this.now(),
      merchantId,
      planId: plan.id,
      currency: plan.currency,
      planPrice: plan.basePrice,
      customerRedemptions: this.promoRedemptions.filter(
        (r) => r.promoCodeId === promo.id && r.customerId === customerId,
      ).length,
    };
  }

  private requireRedeemable(
    code: string,
    ctx: { merchantId: string; customerId: string; plan: BillingPlan },
  ): PromoCode {
    const promo = this.getPromoCode(code);
    if (!promo) this.notFound('Promo code', normalizeCode(code));
    const reason = redemptionError(promo, this.redemptionContext(promo, ctx.merchantId, ctx.customerId, ctx.plan));
    this.validate(reason === null, reason ?? '', 'PROMO_CODE_INVALID');
    return promo;
  }

  private redeem(subscription: Subscription, promo: PromoCode): void {
    const nowIso = new Date(this.now()).toISOString();
    subscription.discount = toAppliedDiscount(promo, nowIso);
    subscription.updatedAt = nowIso;
    promo.timesRedeemed += 1;
    this.promoRedemptions.push({
      promoCodeId: promo.id,
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      redeemedAt: nowIso,
    });
  }

  /** A billing period has ended: count it against a limited-duration discount. */
  private consumeDiscountPeriod(subscription: Subscription): void {
    const discount = subscription.discount;
    if (!discount || discount.duration === 'forever') return;
    discount.remainingPeriods = (discount.remainingPeriods ?? 0) - 1;
    if (discount.remainingPeriods <= 0) subscription.discount = undefined;
  }

  /** Return a past-due subscription to active once no invoice is still in dunning. */
  private reactivateIfSettled(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription || subscription.status !== 'past_due') return;

    const stillRetrying = Array.from(this.invoices.values()).some(
      (invoice) => invoice.subscriptionId === subscriptionId && invoice.dunning?.status === 'retrying',
    );
    if (!stillRetrying) {
      subscription.status = 'active';
      subscription.updatedAt = new Date(this.now()).toISOString();
    }
  }
}

export const subscriptionBillingService = new SubscriptionBillingService();
