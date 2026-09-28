import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { subscriptionBillingService } from '../services/subscription-billing.js';

export const subscriptionBillingRouter = Router();

const pricingTierSchema = z.object({
  upTo: z.number().nonnegative(),
  unitPrice: z.number().nonnegative(),
});

const meterTierSchema = z.object({
  upTo: z.number().positive().nullable(),
  unitPrice: z.number().nonnegative(),
  flatFee: z.number().nonnegative().optional(),
});

const meteredPriceSchema = z.object({
  metric: z.string().min(1).max(80),
  displayName: z.string().min(1).max(120).optional(),
  aggregation: z.enum(['sum', 'max', 'last']).optional(),
  model: z.enum(['per_unit', 'package', 'graduated', 'volume']),
  includedUnits: z.number().nonnegative().optional(),
  unitPrice: z.number().nonnegative().optional(),
  packageSize: z.number().int().positive().optional(),
  packagePrice: z.number().nonnegative().optional(),
  tiers: z.array(meterTierSchema).min(1).optional(),
});

const createPlanSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
  currency: z.string().length(3).optional(),
  basePrice: z.number().nonnegative(),
  includedUnits: z.number().nonnegative().optional(),
  overageUnitPrice: z.number().nonnegative().optional(),
  tiers: z.array(pricingTierSchema).min(1).optional(),
  meters: z.array(meteredPriceSchema).min(1).optional(),
  billingInterval: z.enum(['monthly', 'annual']).optional(),
  features: z.array(z.string()).optional(),
});

const createSubscriptionSchema = z.object({
  merchantId: z.string().min(1),
  customerId: z.string().min(1),
  planId: z.string().min(1),
  trialDays: z.number().int().nonnegative().optional(),
  promoCode: z.string().min(1).max(40).optional(),
});

const recordUsageSchema = z.object({
  subscriptionId: z.string().min(1),
  metric: z.string().min(1).max(80),
  quantity: z.number().positive(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

const cancelSubscriptionSchema = z.object({
  atPeriodEnd: z.boolean().optional(),
});

const changePlanSchema = z.object({
  planId: z.string().min(1),
  prorationBehavior: z.enum(['create_prorations', 'always_invoice', 'none']).optional(),
});

const createPromoCodeSchema = z.object({
  code: z.string().min(3).max(40),
  description: z.string().max(200).optional(),
  merchantId: z.string().min(1).optional(),
  discountType: z.enum(['percent', 'fixed']),
  percentOff: z.number().positive().max(100).optional(),
  amountOff: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  duration: z.enum(['once', 'repeating', 'forever']).optional(),
  durationInPeriods: z.number().int().positive().optional(),
  maxRedemptions: z.number().int().positive().optional(),
  perCustomerLimit: z.number().int().positive().optional(),
  appliesToPlanIds: z.array(z.string().min(1)).optional(),
  minimumAmount: z.number().nonnegative().optional(),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

const validatePromoCodeSchema = z.object({
  code: z.string().min(1).max(40),
  merchantId: z.string().min(1),
  customerId: z.string().min(1),
  planId: z.string().min(1),
});

const applyPromoCodeSchema = z.object({
  code: z.string().min(1).max(40),
});

const dunningConfigSchema = z.object({
  retryScheduleDays: z.array(z.number().positive()).min(1).max(10).optional(),
  finalAction: z.enum(['cancel_subscription', 'mark_uncollectible']).optional(),
});

const paymentAttemptSchema = z.object({
  success: z.boolean(),
  failureReason: z.string().max(200).optional(),
});

/**
 * Translate errors thrown by the in-memory billing service into AppError so the
 * shared error handler preserves status codes and error codes.
 */
const serviceHandler =
  (handler: (req: Request, res: Response) => unknown | Promise<unknown>) =>
  asyncHandler(async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const serviceError = err as { statusCode?: number; code?: string; message?: string };
      if (typeof serviceError?.statusCode === 'number') {
        throw new AppError(serviceError.statusCode, serviceError.message ?? 'Billing error', serviceError.code);
      }
      throw err;
    }
  });

// ------------------------------------------------------------------- plans

subscriptionBillingRouter.post(
  '/plans',
  validate(createPlanSchema),
  serviceHandler((req: Request, res: Response) => {
    res.status(201).json({ data: subscriptionBillingService.createPlan(req.body) });
  }),
);

subscriptionBillingRouter.get(
  '/plans',
  serviceHandler((_req: Request, res: Response) => {
    res.json({ data: subscriptionBillingService.listPlans() });
  }),
);

subscriptionBillingRouter.get(
  '/plans/:id',
  serviceHandler((req: Request, res: Response) => {
    const plan = subscriptionBillingService.getPlan(String(req.params.id));
    if (!plan) throw new AppError(404, 'Billing plan not found', 'NOT_FOUND');
    res.json({ data: plan });
  }),
);

// ----------------------------------------------------------- subscriptions

subscriptionBillingRouter.post(
  '/subscriptions',
  validate(createSubscriptionSchema),
  serviceHandler((req: Request, res: Response) => {
    res.status(201).json({ data: subscriptionBillingService.subscribe(req.body) });
  }),
);

subscriptionBillingRouter.get(
  '/subscriptions',
  serviceHandler((req: Request, res: Response) => {
    const { merchantId, customerId, status } = req.query;
    res.json({
      data: subscriptionBillingService.listSubscriptions({
        merchantId: merchantId as string | undefined,
        customerId: customerId as string | undefined,
        status: status as never,
      }),
    });
  }),
);

subscriptionBillingRouter.get(
  '/subscriptions/:id',
  serviceHandler((req: Request, res: Response) => {
    const subscription = subscriptionBillingService.getSubscription(String(req.params.id));
    if (!subscription) throw new AppError(404, 'Subscription not found', 'NOT_FOUND');
    res.json({ data: subscription });
  }),
);

subscriptionBillingRouter.post(
  '/subscriptions/:id/cancel',
  validate(cancelSubscriptionSchema),
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: subscriptionBillingService.cancelSubscription(String(req.params.id), req.body) });
  }),
);

subscriptionBillingRouter.post(
  '/subscriptions/:id/close-period',
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: subscriptionBillingService.closeBillingPeriod(String(req.params.id)) });
  }),
);

subscriptionBillingRouter.get(
  '/subscriptions/:id/change-plan/preview',
  serviceHandler((req: Request, res: Response) => {
    const planId = req.query.planId;
    if (typeof planId !== 'string' || !planId) {
      throw new AppError(400, 'planId query parameter is required', 'VALIDATION_ERROR');
    }
    res.json({ data: subscriptionBillingService.previewPlanChange(String(req.params.id), planId) });
  }),
);

subscriptionBillingRouter.post(
  '/subscriptions/:id/change-plan',
  validate(changePlanSchema),
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: subscriptionBillingService.changePlan(String(req.params.id), req.body) });
  }),
);

subscriptionBillingRouter.post(
  '/subscriptions/:id/discount',
  validate(applyPromoCodeSchema),
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: subscriptionBillingService.applyPromoCode(String(req.params.id), req.body.code) });
  }),
);

subscriptionBillingRouter.delete(
  '/subscriptions/:id/discount',
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: subscriptionBillingService.removeDiscount(String(req.params.id)) });
  }),
);

// ---------------------------------------------------------------- metering

subscriptionBillingRouter.post(
  '/usage',
  validate(recordUsageSchema),
  serviceHandler((req: Request, res: Response) => {
    res.status(201).json({ data: subscriptionBillingService.recordUsage(req.body) });
  }),
);

subscriptionBillingRouter.get(
  '/subscriptions/:id/usage',
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: subscriptionBillingService.getUsage(String(req.params.id)) });
  }),
);

subscriptionBillingRouter.get(
  '/subscriptions/:id/usage-events',
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: subscriptionBillingService.listUsageEvents(String(req.params.id)) });
  }),
);

// --------------------------------------------------------------- invoices

subscriptionBillingRouter.post(
  '/subscriptions/:id/invoices',
  serviceHandler((req: Request, res: Response) => {
    res.status(201).json({ data: subscriptionBillingService.generateInvoice(String(req.params.id)) });
  }),
);

subscriptionBillingRouter.get(
  '/invoices',
  serviceHandler((req: Request, res: Response) => {
    const { subscriptionId, merchantId, status } = req.query;
    res.json({
      data: subscriptionBillingService.listInvoices({
        subscriptionId: subscriptionId as string | undefined,
        merchantId: merchantId as string | undefined,
        status: status as never,
      }),
    });
  }),
);

subscriptionBillingRouter.get(
  '/invoices/:id',
  serviceHandler((req: Request, res: Response) => {
    const invoice = subscriptionBillingService.getInvoice(String(req.params.id));
    if (!invoice) throw new AppError(404, 'Invoice not found', 'NOT_FOUND');
    res.json({ data: invoice });
  }),
);

subscriptionBillingRouter.post(
  '/invoices/:id/pay',
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: subscriptionBillingService.markInvoicePaid(String(req.params.id)) });
  }),
);

subscriptionBillingRouter.post(
  '/invoices/:id/void',
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: subscriptionBillingService.voidInvoice(String(req.params.id)) });
  }),
);

subscriptionBillingRouter.post(
  '/invoices/:id/payment-attempts',
  validate(paymentAttemptSchema),
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: subscriptionBillingService.recordPaymentAttempt(String(req.params.id), req.body) });
  }),
);

// ------------------------------------------------------------- promo codes

subscriptionBillingRouter.post(
  '/promo-codes',
  validate(createPromoCodeSchema),
  serviceHandler((req: Request, res: Response) => {
    res.status(201).json({ data: subscriptionBillingService.createPromoCode(req.body) });
  }),
);

subscriptionBillingRouter.get(
  '/promo-codes',
  serviceHandler((req: Request, res: Response) => {
    const { merchantId, active } = req.query;
    res.json({
      data: subscriptionBillingService.listPromoCodes({
        merchantId: merchantId as string | undefined,
        active: active === undefined ? undefined : active === 'true',
      }),
    });
  }),
);

subscriptionBillingRouter.post(
  '/promo-codes/validate',
  validate(validatePromoCodeSchema),
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: subscriptionBillingService.validatePromoCode(req.body) });
  }),
);

subscriptionBillingRouter.get(
  '/promo-codes/:code',
  serviceHandler((req: Request, res: Response) => {
    const promo = subscriptionBillingService.getPromoCode(String(req.params.code));
    if (!promo) throw new AppError(404, 'Promo code not found', 'NOT_FOUND');
    res.json({ data: promo });
  }),
);

subscriptionBillingRouter.post(
  '/promo-codes/:code/deactivate',
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: subscriptionBillingService.deactivatePromoCode(String(req.params.code)) });
  }),
);

// ----------------------------------------------------------------- dunning

subscriptionBillingRouter.get(
  '/dunning/config/:merchantId',
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: subscriptionBillingService.getDunningConfig(String(req.params.merchantId)) });
  }),
);

subscriptionBillingRouter.put(
  '/dunning/config/:merchantId',
  validate(dunningConfigSchema),
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: subscriptionBillingService.configureDunning(String(req.params.merchantId), req.body) });
  }),
);

subscriptionBillingRouter.get(
  '/dunning/invoices',
  serviceHandler((req: Request, res: Response) => {
    const { merchantId, status } = req.query;
    res.json({
      data: subscriptionBillingService.listDunningInvoices({
        merchantId: merchantId as string | undefined,
        status: status as never,
      }),
    });
  }),
);

subscriptionBillingRouter.post(
  '/dunning/process',
  serviceHandler(async (_req: Request, res: Response) => {
    res.json({ data: await subscriptionBillingService.processDunning() });
  }),
);
