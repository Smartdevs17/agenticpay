import { beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionBillingService } from '../subscription-billing.js';

describe('SubscriptionBillingService — usage metering (#914)', () => {
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

  const seedPlan = (overrides: Partial<Parameters<typeof service.createPlan>[0]> = {}) =>
    service.createPlan({
      name: 'Pro',
      basePrice: 49,
      includedUnits: 1_000,
      overageUnitPrice: 0.01,
      ...overrides,
    });

  describe('plans', () => {
    it('creates a normalized plan with sensible defaults', () => {
      const plan = seedPlan({ currency: 'eur' });
      expect(plan.currency).toBe('EUR');
      expect(plan.billingInterval).toBe('monthly');
      expect(plan.basePrice).toBe(49);
      expect(plan.id).toMatch(/^plan_/);
    });

    it('rejects a blank plan name', () => {
      expectError(() => seedPlan({ name: '   ' }), 400, /name is required/);
    });

    it('rejects negative pricing', () => {
      expectError(() => seedPlan({ basePrice: -1 }), 400, /basePrice cannot be negative/);
      expectError(() => seedPlan({ overageUnitPrice: -0.5 }), 400, /overageUnitPrice/);
    });

    it('rejects unsorted or duplicate tiers', () => {
      expectError(
        () => seedPlan({ tiers: [{ upTo: 2000, unitPrice: 0.02 }, { upTo: 1000, unitPrice: 0.03 }] }),
        400,
        /ascending/,
      );
    });

    it('stores and lists plans', () => {
      const plan = seedPlan();
      expect(service.getPlan(plan.id)?.name).toBe('Pro');
      expect(service.listPlans()).toHaveLength(1);
      expect(service.getPlan('missing')).toBeUndefined();
    });
  });

  describe('subscriptions', () => {
    it('subscribes a customer to a monthly plan', () => {
      const plan = seedPlan();
      const subscription = service.subscribe({ merchantId: 'm1', customerId: 'c1', planId: plan.id });

      expect(subscription.status).toBe('active');
      const days =
        (new Date(subscription.currentPeriodEnd).getTime() -
          new Date(subscription.currentPeriodStart).getTime()) /
        (24 * 60 * 60 * 1000);
      expect(days).toBe(30);
    });

    it('starts a trial when trialDays is supplied', () => {
      const plan = seedPlan();
      const subscription = service.subscribe({
        merchantId: 'm1',
        customerId: 'c1',
        planId: plan.id,
        trialDays: 14,
      });
      expect(subscription.status).toBe('trialing');
      expect(subscription.trialEndsAt).toBeTruthy();
    });

    it('reports an unknown plan', () => {
      expectError(
        () => service.subscribe({ merchantId: 'm1', customerId: 'c1', planId: 'nope' }),
        404,
        /Billing plan not found/,
      );
    });

    it('requires a merchant and customer', () => {
      const plan = seedPlan();
      expectError(
        () => service.subscribe({ merchantId: '', customerId: 'c1', planId: plan.id }),
        400,
        /merchantId is required/,
      );
    });

    it('filters subscriptions', () => {
      const plan = seedPlan();
      service.subscribe({ merchantId: 'm1', customerId: 'c1', planId: plan.id });
      service.subscribe({ merchantId: 'm2', customerId: 'c2', planId: plan.id, trialDays: 7 });

      expect(service.listSubscriptions({ merchantId: 'm1' })).toHaveLength(1);
      expect(service.listSubscriptions({ status: 'trialing' })).toHaveLength(1);
    });
  });

  describe('usage metering', () => {
    let subscriptionId: string;

    beforeEach(() => {
      const plan = seedPlan();
      subscriptionId = service.subscribe({ merchantId: 'm1', customerId: 'c1', planId: plan.id }).id;
    });

    it('aggregates usage per metric', () => {
      service.recordUsage({ subscriptionId, metric: 'api_calls', quantity: 100 });
      service.recordUsage({ subscriptionId, metric: 'api_calls', quantity: 250 });
      service.recordUsage({ subscriptionId, metric: 'storage_gb', quantity: 5 });

      const summary = service.getUsage(subscriptionId);
      expect(summary.metrics).toEqual({ api_calls: 350, storage_gb: 5 });
      expect(summary.totalUnits).toBe(355);
      expect(summary.overageUnits).toBe(0);
      expect(summary.usageAmount).toBe(0);
    });

    it('deduplicates events sharing an idempotency key', () => {
      const first = service.recordUsage({
        subscriptionId,
        metric: 'api_calls',
        quantity: 100,
        idempotencyKey: 'evt-1',
      });
      const second = service.recordUsage({
        subscriptionId,
        metric: 'api_calls',
        quantity: 100,
        idempotencyKey: 'evt-1',
      });

      expect(second.id).toBe(first.id);
      expect(service.listUsageEvents(subscriptionId)).toHaveLength(1);
      expect(service.getUsage(subscriptionId).totalUnits).toBe(100);
    });

    it('rejects non-positive quantities', () => {
      expectError(
        () => service.recordUsage({ subscriptionId, metric: 'api_calls', quantity: 0 }),
        400,
        /greater than 0/,
      );
    });

    it('rejects unknown subscriptions', () => {
      expectError(
        () => service.recordUsage({ subscriptionId: 'ghost', metric: 'api_calls', quantity: 1 }),
        404,
        /Subscription not found/,
      );
    });

    it('refuses to meter a cancelled subscription', () => {
      service.cancelSubscription(subscriptionId);
      expectError(
        () => service.recordUsage({ subscriptionId, metric: 'api_calls', quantity: 1 }),
        400,
        /cancelled subscription/,
      );
    });
  });

  describe('overage pricing', () => {
    it('charges the flat overage rate past the included units', () => {
      const plan = seedPlan({ includedUnits: 1_000, overageUnitPrice: 0.05 });
      const subscriptionId = service.subscribe({ merchantId: 'm', customerId: 'c', planId: plan.id }).id;

      service.recordUsage({ subscriptionId, metric: 'api_calls', quantity: 1_200 });

      const summary = service.getUsage(subscriptionId);
      expect(summary.overageUnits).toBe(200);
      expect(summary.usageAmount).toBe(10);
    });

    it('applies graduated tiers', () => {
      const plan = seedPlan({
        includedUnits: 0,
        overageUnitPrice: 0.2,
        tiers: [
          { upTo: 1_000, unitPrice: 0.01 },
          { upTo: 5_000, unitPrice: 0.005 },
        ],
      });
      const subscriptionId = service.subscribe({ merchantId: 'm', customerId: 'c', planId: plan.id }).id;

      // 1_000 * 0.01 + 4_000 * 0.005 + 1_000 * 0.2 = 10 + 20 + 200 = 230
      service.recordUsage({ subscriptionId, metric: 'api_calls', quantity: 6_000 });

      const summary = service.getUsage(subscriptionId);
      expect(summary.overageUnits).toBe(6_000);
      expect(summary.usageAmount).toBe(230);
    });
  });

  describe('invoicing', () => {
    it('invoices the base fee when usage is within the allowance', () => {
      const plan = seedPlan({ includedUnits: 1_000 });
      const subscriptionId = service.subscribe({ merchantId: 'm1', customerId: 'c1', planId: plan.id }).id;
      service.recordUsage({ subscriptionId, metric: 'api_calls', quantity: 500 });

      const invoice = service.generateInvoice(subscriptionId);
      expect(invoice.baseAmount).toBe(49);
      expect(invoice.usageAmount).toBe(0);
      expect(invoice.total).toBe(49);
      expect(invoice.status).toBe('open');
      expect(invoice.lineItems).toHaveLength(1);
      expect(invoice.currency).toBe('USD');
    });

    it('adds a metered overage line item when usage exceeds the allowance', () => {
      const plan = seedPlan({ includedUnits: 1_000, overageUnitPrice: 0.1 });
      const subscriptionId = service.subscribe({ merchantId: 'm1', customerId: 'c1', planId: plan.id }).id;
      service.recordUsage({ subscriptionId, metric: 'api_calls', quantity: 1_500 });

      const invoice = service.generateInvoice(subscriptionId);
      expect(invoice.usageAmount).toBe(50);
      expect(invoice.total).toBe(99);
      expect(invoice.lineItems).toHaveLength(2);
      expect(invoice.lineItems[1]).toMatchObject({ description: 'Metered overage', quantity: 500, amount: 50 });
    });

    it('rolls the period and resets usage when closing a billing period', () => {
      const plan = seedPlan();
      const subscriptionId = service.subscribe({ merchantId: 'm1', customerId: 'c1', planId: plan.id }).id;
      service.recordUsage({ subscriptionId, metric: 'api_calls', quantity: 1_500 });

      const firstPeriodEnd = service.getSubscription(subscriptionId)!.currentPeriodEnd;
      const { invoice, subscription } = service.closeBillingPeriod(subscriptionId);

      expect(invoice.usageAmount).toBe(5); // 500 overage * 0.01
      expect(subscription.currentPeriodStart).toBe(firstPeriodEnd);
      expect(service.getUsage(subscriptionId).totalUnits).toBe(0);
      expect(service.listInvoices({ subscriptionId })).toHaveLength(1);
    });

    it('cancels at period end when closing the period', () => {
      const plan = seedPlan();
      const subscriptionId = service.subscribe({ merchantId: 'm1', customerId: 'c1', planId: plan.id }).id;
      service.cancelSubscription(subscriptionId, { atPeriodEnd: true });
      expect(service.getSubscription(subscriptionId)!.status).toBe('active');

      const { subscription } = service.closeBillingPeriod(subscriptionId);
      expect(subscription.status).toBe('cancelled');
    });

    it('pays and voids invoices with valid transitions only', () => {
      const plan = seedPlan();
      const subscriptionId = service.subscribe({ merchantId: 'm1', customerId: 'c1', planId: plan.id }).id;

      const paid = service.generateInvoice(subscriptionId);
      expect(service.markInvoicePaid(paid.id).status).toBe('paid');
      expectError(() => service.markInvoicePaid(paid.id), 400, /cannot be paid/);
      expectError(() => service.voidInvoice(paid.id), 409, /cannot be voided/);

      const voided = service.generateInvoice(subscriptionId);
      expect(service.voidInvoice(voided.id).status).toBe('void');
    });

    it('reports missing invoices and subscriptions', () => {
      expectError(() => service.markInvoicePaid('nope'), 404, /Invoice not found/);
      expectError(() => service.generateInvoice('nope'), 404, /Subscription not found/);
    });
  });

  it('clears state between tests', () => {
    seedPlan();
    service.resetForTests();
    expect(service.listPlans()).toHaveLength(0);
  });
});
