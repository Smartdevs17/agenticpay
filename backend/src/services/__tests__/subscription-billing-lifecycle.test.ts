import { beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionBillingService } from '../subscription-billing.js';

const DAY = 24 * 60 * 60 * 1000;

describe('SubscriptionBillingService — billing lifecycle (#812, #813, #814, #815)', () => {
  let service: SubscriptionBillingService;
  let now: number;

  beforeEach(() => {
    now = new Date('2026-02-01T00:00:00.000Z').getTime();
    service = new SubscriptionBillingService(() => now);
  });

  const expectError = (fn: () => unknown, statusCode: number, message?: RegExp) => {
    try {
      fn();
      throw new Error('Expected function to throw');
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      expect(error.statusCode).toBe(statusCode);
      if (message) expect(error.message).toMatch(message);
    }
  };

  const seedPlans = () => {
    const basic = service.createPlan({ id: 'basic', name: 'Basic', basePrice: 30 });
    const pro = service.createPlan({ id: 'pro', name: 'Pro', basePrice: 60 });
    return { basic, pro };
  };

  const subscribe = (planId: string, extra: { customerId?: string; promoCode?: string; trialDays?: number } = {}) =>
    service.subscribe({ merchantId: 'm1', customerId: extra.customerId ?? 'c1', planId, ...extra });

  // --------------------------------------------------------------- #815

  describe('usage-based billing with metered pricing (#815)', () => {
    const seedMeteredPlan = () =>
      service.createPlan({
        id: 'usage',
        name: 'Usage',
        basePrice: 0,
        meters: [
          { metric: 'api_calls', model: 'per_unit', includedUnits: 1_000, unitPrice: 0.002 },
          { metric: 'seats', displayName: 'Seats', aggregation: 'max', model: 'per_unit', unitPrice: 10 },
          {
            metric: 'storage_gb',
            aggregation: 'last',
            model: 'volume',
            tiers: [
              { upTo: 100, unitPrice: 0.5 },
              { upTo: null, unitPrice: 0.25 },
            ],
          },
        ],
      });

    it('normalises meter defaults on the plan', () => {
      const plan = seedMeteredPlan();
      expect(plan.meters?.[0]).toMatchObject({ aggregation: 'sum', includedUnits: 1_000 });
    });

    it('aggregates and prices each meter independently', () => {
      seedMeteredPlan();
      const { id } = subscribe('usage');

      service.recordUsage({ subscriptionId: id, metric: 'api_calls', quantity: 700 });
      service.recordUsage({ subscriptionId: id, metric: 'api_calls', quantity: 800 });
      for (const seats of [3, 5, 4]) service.recordUsage({ subscriptionId: id, metric: 'seats', quantity: seats });
      service.recordUsage({ subscriptionId: id, metric: 'storage_gb', quantity: 300 });
      service.recordUsage({ subscriptionId: id, metric: 'storage_gb', quantity: 80 });

      const usage = service.getUsage(id);
      const byMetric = Object.fromEntries(usage.meters!.map((m) => [m.metric, m]));
      expect(byMetric.api_calls).toMatchObject({ quantity: 1_500, billableUnits: 500, amount: 1 });
      expect(byMetric.seats).toMatchObject({ quantity: 5, amount: 50 });
      expect(byMetric.storage_gb).toMatchObject({ quantity: 80, amount: 40 });
      expect(usage.usageAmount).toBe(91);

      const invoice = service.generateInvoice(id);
      expect(invoice.usageAmount).toBe(91);
      expect(invoice.total).toBe(91);
      expect(invoice.lineItems.map((l) => l.description)).toEqual([
        'Base plan — Usage',
        'Metered usage — api_calls',
        'Metered usage — Seats',
        'Metered usage — storage_gb',
      ]);
    });

    it('rejects usage for metrics the plan does not meter', () => {
      seedMeteredPlan();
      const { id } = subscribe('usage');
      expectError(
        () => service.recordUsage({ subscriptionId: id, metric: 'bandwidth', quantity: 1 }),
        400,
        /not metered on plan/,
      );
    });

    it('resets meter readings when the period closes', () => {
      seedMeteredPlan();
      const { id } = subscribe('usage');
      service.recordUsage({ subscriptionId: id, metric: 'seats', quantity: 5 });

      service.closeBillingPeriod(id);
      expect(service.getUsage(id).usageAmount).toBe(0);
      expect(service.getSubscription(id)!.meterReadings).toEqual({});
    });

    it('rejects invalid or duplicate meters', () => {
      expectError(
        () => service.createPlan({ name: 'Bad', basePrice: 0, meters: [{ metric: 'x', model: 'per_unit' }] }),
        400,
        /unitPrice/,
      );
      expectError(
        () =>
          service.createPlan({
            name: 'Dup',
            basePrice: 0,
            meters: [
              { metric: 'x', model: 'per_unit', unitPrice: 1 },
              { metric: 'x', model: 'per_unit', unitPrice: 2 },
            ],
          }),
        400,
        /Duplicate meter/,
      );
    });
  });

  // --------------------------------------------------------------- #812

  describe('proration for mid-cycle plan changes (#812)', () => {
    it('previews a plan change without mutating the subscription', () => {
      seedPlans();
      const { id } = subscribe('basic');
      now += 10 * DAY;

      const preview = service.previewPlanChange(id, 'pro');
      expect(preview).toMatchObject({ unusedCredit: 20, remainingCharge: 40, net: 20, intervalChange: false });
      expect(service.getSubscription(id)!.planId).toBe('basic');
    });

    it('splits the closing invoice between plans with create_prorations', () => {
      seedPlans();
      const { id } = subscribe('basic');
      now += 10 * DAY;

      const result = service.changePlan(id, { planId: 'pro' });
      expect(result.proration?.net).toBe(20);
      expect(result.invoice).toBeUndefined();
      expect(result.subscription.planId).toBe('pro');

      now += 20 * DAY;
      const { invoice } = service.closeBillingPeriod(id);
      // 30 * 1/3 + 60 * 2/3
      expect(invoice.baseAmount).toBe(50);
      expect(invoice.lineItems).toHaveLength(2);
      expect(invoice.lineItems[0].description).toMatch(/Basic \(prorated/);
      expect(invoice.lineItems[1].description).toMatch(/Pro \(prorated/);

      // The next period is billed in full on the new plan.
      expect(service.closeBillingPeriod(id).invoice.baseAmount).toBe(60);
    });

    it('credits a downgrade', () => {
      seedPlans();
      const { id } = subscribe('pro');
      now += 15 * DAY;

      const { proration } = service.changePlan(id, { planId: 'basic' });
      expect(proration?.net).toBe(-15);
      expect(service.closeBillingPeriod(id).invoice.baseAmount).toBe(45);
    });

    it('invoices the elapsed time and usage immediately with always_invoice', () => {
      service.createPlan({ id: 'basic', name: 'Basic', basePrice: 30, overageUnitPrice: 1 });
      service.createPlan({ id: 'pro', name: 'Pro', basePrice: 60 });
      const { id } = subscribe('basic');
      service.recordUsage({ subscriptionId: id, metric: 'api_calls', quantity: 5 });
      now += 10 * DAY;

      const { invoice } = service.changePlan(id, { planId: 'pro', prorationBehavior: 'always_invoice' });
      expect(invoice).toMatchObject({ kind: 'plan_change', baseAmount: 10, usageAmount: 5, total: 15 });
      expect(invoice!.periodEnd).toBe(new Date(now).toISOString());
      expect(service.getUsage(id).totalUnits).toBe(0);

      now += 20 * DAY;
      expect(service.closeBillingPeriod(id).invoice.baseAmount).toBe(40);
    });

    it('bills the whole period on the new plan with none', () => {
      seedPlans();
      const { id } = subscribe('basic');
      now += 10 * DAY;

      expect(service.changePlan(id, { planId: 'pro', prorationBehavior: 'none' }).proration).toBeNull();
      const { invoice } = service.closeBillingPeriod(id);
      expect(invoice.baseAmount).toBe(60);
      expect(invoice.lineItems).toHaveLength(1);
    });

    it('settles and restarts the period on a billing interval change', () => {
      seedPlans();
      service.createPlan({ id: 'pro-annual', name: 'Pro Annual', basePrice: 600, billingInterval: 'annual' });
      const { id } = subscribe('basic');
      now += 10 * DAY;

      expectError(
        () => service.changePlan(id, { planId: 'pro-annual', prorationBehavior: 'none' }),
        400,
        /requires proration/,
      );

      const { invoice, subscription } = service.changePlan(id, { planId: 'pro-annual' });
      expect(invoice).toMatchObject({ kind: 'plan_change', baseAmount: 10 });
      expect(subscription.currentPeriodStart).toBe(new Date(now).toISOString());
      expect(subscription.currentPeriodEnd).toBe(new Date(now + 365 * DAY).toISOString());
    });

    it('switches plans without proration during a trial', () => {
      seedPlans();
      const { id } = subscribe('basic', { trialDays: 14 });
      now += 5 * DAY;

      const result = service.changePlan(id, { planId: 'pro' });
      expect(result.proration).toBeNull();
      expect(result.subscription.planSegments).toEqual([
        { planId: 'pro', startedAt: result.subscription.currentPeriodStart },
      ]);
    });

    it('rejects invalid plan changes', () => {
      seedPlans();
      service.createPlan({ id: 'euro', name: 'Euro', basePrice: 30, currency: 'EUR' });
      const { id } = subscribe('basic');

      expectError(() => service.changePlan(id, { planId: 'basic' }), 409, /already on this plan/);
      expectError(() => service.changePlan(id, { planId: 'euro' }), 400, /USD plan to a EUR plan/);
      expectError(() => service.changePlan(id, { planId: 'missing' }), 404, /Billing plan not found/);
      service.cancelSubscription(id);
      expectError(() => service.changePlan(id, { planId: 'pro' }), 409, /cancelled subscription/);
    });
  });

  // --------------------------------------------------------------- #814

  describe('promotional codes and discounts (#814)', () => {
    it('applies a one-period percentage discount at subscription time', () => {
      service.createPlan({ id: 'pro', name: 'Pro', basePrice: 49 });
      service.createPromoCode({ code: 'save20', discountType: 'percent', percentOff: 20 });

      const { id } = subscribe('pro', { promoCode: 'SAVE20' });
      const first = service.closeBillingPeriod(id).invoice;
      expect(first).toMatchObject({ subtotal: 49, discountAmount: 9.8, discountCode: 'SAVE20', total: 39.2 });
      expect(first.lineItems.at(-1)).toMatchObject({ description: 'Discount — SAVE20', amount: -9.8 });

      expect(service.getSubscription(id)!.discount).toBeUndefined();
      expect(service.closeBillingPeriod(id).invoice.total).toBe(49);
    });

    it('limits repeating discounts to the configured number of periods', () => {
      service.createPlan({ id: 'pro', name: 'Pro', basePrice: 50 });
      service.createPromoCode({
        code: 'TENOFF',
        discountType: 'fixed',
        amountOff: 10,
        currency: 'usd',
        duration: 'repeating',
        durationInPeriods: 2,
      });

      const { id } = subscribe('pro', { promoCode: 'tenoff' });
      const totals = [1, 2, 3].map(() => service.closeBillingPeriod(id).invoice.total);
      expect(totals).toEqual([40, 40, 50]);
    });

    it('keeps forever discounts across periods', () => {
      service.createPlan({ id: 'pro', name: 'Pro', basePrice: 50 });
      service.createPromoCode({ code: 'LOYAL', discountType: 'percent', percentOff: 10, duration: 'forever' });
      const { id } = subscribe('pro', { promoCode: 'LOYAL' });

      const totals = [1, 2, 3].map(() => service.closeBillingPeriod(id).invoice.total);
      expect(totals).toEqual([45, 45, 45]);
    });

    it('does not create a subscription when the promo code is invalid', () => {
      service.createPlan({ id: 'pro', name: 'Pro', basePrice: 49 });
      service.createPromoCode({ code: 'OLD', discountType: 'percent', percentOff: 10 });
      service.deactivatePromoCode('old');

      expectError(() => subscribe('pro', { promoCode: 'OLD' }), 400, /inactive/);
      expectError(() => subscribe('pro', { promoCode: 'NOPE' }), 404, /Promo code not found/);
      expect(service.listSubscriptions()).toHaveLength(0);
    });

    it('enforces per-customer and total redemption limits', () => {
      service.createPlan({ id: 'pro', name: 'Pro', basePrice: 49 });
      const promo = service.createPromoCode({
        code: 'LAUNCH',
        discountType: 'percent',
        percentOff: 50,
        maxRedemptions: 2,
      });

      subscribe('pro', { customerId: 'c1', promoCode: 'LAUNCH' });
      expectError(() => subscribe('pro', { customerId: 'c1', promoCode: 'LAUNCH' }), 400, /already redeemed/);
      subscribe('pro', { customerId: 'c2', promoCode: 'LAUNCH' });
      expectError(() => subscribe('pro', { customerId: 'c3', promoCode: 'LAUNCH' }), 400, /redemption limit/);

      expect(service.getPromoCode(promo.id)!.timesRedeemed).toBe(2);
      expect(service.listPromoRedemptions(promo.id)).toHaveLength(2);
    });

    it('validates a code without redeeming it', () => {
      service.createPlan({ id: 'pro', name: 'Pro', basePrice: 49 });
      service.createPlan({ id: 'basic', name: 'Basic', basePrice: 19 });
      service.createPromoCode({ code: 'PROONLY', discountType: 'percent', percentOff: 20, appliesToPlanIds: ['pro'] });

      const ok = service.validatePromoCode({ code: 'proonly', merchantId: 'm1', customerId: 'c1', planId: 'pro' });
      expect(ok).toMatchObject({ valid: true, estimatedDiscount: 9.8 });

      const wrongPlan = service.validatePromoCode({ code: 'PROONLY', merchantId: 'm1', customerId: 'c1', planId: 'basic' });
      expect(wrongPlan).toMatchObject({ valid: false, reason: 'Promo code does not apply to this plan' });

      expect(service.validatePromoCode({ code: 'X', merchantId: 'm1', customerId: 'c1', planId: 'pro' }).valid).toBe(false);
      expect(service.getPromoCode('PROONLY')!.timesRedeemed).toBe(0);
    });

    it('applies and removes discounts on an existing subscription', () => {
      service.createPlan({ id: 'pro', name: 'Pro', basePrice: 50 });
      service.createPromoCode({ code: 'FIRST', discountType: 'percent', percentOff: 10, duration: 'forever' });
      service.createPromoCode({ code: 'SECOND', discountType: 'percent', percentOff: 20, duration: 'forever' });
      const { id } = subscribe('pro');

      service.applyPromoCode(id, 'FIRST');
      expectError(() => service.applyPromoCode(id, 'SECOND'), 409, /already has an active discount/);

      service.removeDiscount(id);
      service.applyPromoCode(id, 'SECOND');
      expect(service.generateInvoice(id).total).toBe(40);
      expectError(() => service.removeDiscount('missing'), 404);
    });

    it('rejects duplicate codes and unknown plan restrictions', () => {
      service.createPromoCode({ code: 'DUP', discountType: 'percent', percentOff: 10 });
      expectError(() => service.createPromoCode({ code: 'dup', discountType: 'percent', percentOff: 5 }), 409);
      expectError(
        () => service.createPromoCode({ code: 'GHOST', discountType: 'percent', percentOff: 5, appliesToPlanIds: ['x'] }),
        404,
      );
      expectError(() => service.createPromoCode({ code: 'BAD', discountType: 'percent', percentOff: 0 }), 400);
    });
  });

  // --------------------------------------------------------------- #813

  describe('dunning management (#813)', () => {
    const openInvoice = () => {
      seedPlans();
      const subscription = subscribe('basic');
      const invoice = service.generateInvoice(subscription.id);
      return { subscriptionId: subscription.id, invoiceId: invoice.id };
    };

    it('starts dunning on the first failure and marks the subscription past due', () => {
      const { subscriptionId, invoiceId } = openInvoice();

      const invoice = service.recordPaymentAttempt(invoiceId, { success: false, failureReason: 'card_declined' });
      expect(invoice.dunning).toMatchObject({
        status: 'retrying',
        retriesAttempted: 0,
        retryScheduleDays: [1, 3, 5, 7],
        nextRetryAt: new Date(now + DAY).toISOString(),
      });
      expect(invoice.dunning!.history[0]).toMatchObject({ attempt: 0, success: false, failureReason: 'card_declined' });
      expect(service.getSubscription(subscriptionId)!.status).toBe('past_due');

      // Service keeps running while dunning is in progress.
      expect(() => service.recordUsage({ subscriptionId, metric: 'api_calls', quantity: 1 })).not.toThrow();
    });

    it('recovers when a retry succeeds', () => {
      const { subscriptionId, invoiceId } = openInvoice();
      service.recordPaymentAttempt(invoiceId, { success: false });
      now += DAY;

      const invoice = service.recordPaymentAttempt(invoiceId, { success: true });
      expect(invoice.status).toBe('paid');
      expect(invoice.dunning).toMatchObject({ status: 'recovered', retriesAttempted: 1 });
      expect(invoice.dunning!.nextRetryAt).toBeUndefined();
      expect(service.getSubscription(subscriptionId)!.status).toBe('active');
    });

    it('cancels the subscription once the default schedule is exhausted', () => {
      const { subscriptionId, invoiceId } = openInvoice();
      service.recordPaymentAttempt(invoiceId, { success: false });

      const expectedRetries = [3, 5, 7].map((d) => new Date(now + d * DAY).toISOString());
      for (const retryAt of expectedRetries) {
        expect(service.recordPaymentAttempt(invoiceId, { success: false }).dunning!.nextRetryAt).toBe(retryAt);
      }

      const invoice = service.recordPaymentAttempt(invoiceId, { success: false });
      expect(invoice.status).toBe('uncollectible');
      expect(invoice.dunning).toMatchObject({ status: 'exhausted', retriesAttempted: 4 });
      expect(invoice.dunning!.history).toHaveLength(5);
      expect(service.getSubscription(subscriptionId)!.status).toBe('cancelled');
    });

    it('honours a merchant schedule and mark_uncollectible final action', () => {
      service.configureDunning('m1', { retryScheduleDays: [2], finalAction: 'mark_uncollectible' });
      const { subscriptionId, invoiceId } = openInvoice();

      expect(service.recordPaymentAttempt(invoiceId, { success: false }).dunning!.nextRetryAt).toBe(
        new Date(now + 2 * DAY).toISOString(),
      );
      // Later config changes do not affect dunning already in progress.
      service.configureDunning('m1', { retryScheduleDays: [1, 2, 3] });

      const invoice = service.recordPaymentAttempt(invoiceId, { success: false });
      expect(invoice.status).toBe('uncollectible');
      expect(service.getSubscription(subscriptionId)!.status).toBe('past_due');

      // An uncollectible invoice can still be paid later, which reactivates the subscription.
      expect(service.markInvoicePaid(invoiceId).status).toBe('paid');
      expect(service.getSubscription(subscriptionId)!.status).toBe('active');
    });

    it('returns defaults and rejects invalid configuration', () => {
      expect(service.getDunningConfig('m9')).toMatchObject({
        retryScheduleDays: [1, 3, 5, 7],
        finalAction: 'cancel_subscription',
      });
      expectError(() => service.configureDunning('m1', { retryScheduleDays: [5, 2] }), 400, /ascending/);
      expectError(() => service.configureDunning('m1', { retryScheduleDays: [] }), 400, /at least one/);
    });

    it('stops dunning when the invoice is paid manually or voided', () => {
      const first = openInvoice();
      service.recordPaymentAttempt(first.invoiceId, { success: false });
      expect(service.markInvoicePaid(first.invoiceId).dunning!.status).toBe('recovered');
      expect(service.getSubscription(first.subscriptionId)!.status).toBe('active');

      const second = service.generateInvoice(first.subscriptionId);
      service.recordPaymentAttempt(second.id, { success: false });
      expect(service.voidInvoice(second.id).dunning!.status).toBe('stopped');
      expect(service.getSubscription(first.subscriptionId)!.status).toBe('active');
    });

    it('refuses attempts on settled invoices', () => {
      const { invoiceId } = openInvoice();
      service.markInvoicePaid(invoiceId);
      expectError(() => service.recordPaymentAttempt(invoiceId, { success: false }), 409, /paid invoice/);
      expectError(() => service.recordPaymentAttempt('missing', { success: true }), 404);
    });

    describe('processDunning', () => {
      it('retries only due invoices using the payment attempter', async () => {
        seedPlans();
        const a = service.generateInvoice(subscribe('basic', { customerId: 'a' }).id);
        const b = service.generateInvoice(subscribe('basic', { customerId: 'b' }).id);
        service.recordPaymentAttempt(a.id, { success: false });
        now += 12 * 60 * 60 * 1000;
        service.recordPaymentAttempt(b.id, { success: false });
        now += 12 * 60 * 60 * 1000; // a is due, b is not yet

        const attempted: string[] = [];
        const result = await service.processDunning((invoice) => {
          attempted.push(invoice.id);
          return { success: true };
        });

        expect(attempted).toEqual([a.id]);
        expect(result).toEqual({ processed: 1, recovered: [a.id], failed: [], exhausted: [] });
      });

      it('treats a throwing attempter as a failed retry', async () => {
        service.configureDunning('m1', { retryScheduleDays: [1, 2] });
        const { invoiceId } = openInvoice();
        service.recordPaymentAttempt(invoiceId, { success: false });
        now += DAY;

        service.setPaymentAttempter(() => {
          throw new Error('gateway timeout');
        });
        const first = await service.processDunning();
        expect(first.failed).toEqual([invoiceId]);
        expect(service.getInvoice(invoiceId)!.dunning!.history.at(-1)).toMatchObject({
          success: false,
          failureReason: 'gateway timeout',
        });

        now += DAY;
        const second = await service.processDunning();
        expect(second.exhausted).toEqual([invoiceId]);
        expect(service.listDunningInvoices({ status: 'exhausted' })).toHaveLength(1);
      });

      it('requires a payment attempter', async () => {
        await expect(service.processDunning()).rejects.toMatchObject({ statusCode: 409 });
      });
    });
  });
});
