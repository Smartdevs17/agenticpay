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

const createPlanSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
  currency: z.string().length(3).optional(),
  basePrice: z.number().nonnegative(),
  includedUnits: z.number().nonnegative().optional(),
  overageUnitPrice: z.number().nonnegative().optional(),
  tiers: z.array(pricingTierSchema).min(1).optional(),
  billingInterval: z.enum(['monthly', 'annual']).optional(),
  features: z.array(z.string()).optional(),
});

const createSubscriptionSchema = z.object({
  merchantId: z.string().min(1),
  customerId: z.string().min(1),
  planId: z.string().min(1),
  trialDays: z.number().int().nonnegative().optional(),
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
