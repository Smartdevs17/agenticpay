import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import * as stripeService from '../services/stripe.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const prisma = new PrismaClient();

// ── Validation Schemas ───────────────────────────────────────────────────────

const CreateSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  userId: z.string().uuid(),
  paymentMethodId: z.string().optional(),
});

const UpdateSubscriptionSchema = z.object({
  planId: z.string().uuid().optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
});

const RecordUsageSchema = z.object({
  metricType: z.enum(['api_calls', 'storage_gb', 'compute_hours', 'transactions', 'custom']),
  quantity: z.number().int().positive(),
  metadata: z.record(z.string()).optional(),
});

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/subscriptions
 * Create a new subscription for a user
 */
router.post('/', async (req, res, next) => {
  try {
    const { planId, userId, paymentMethodId } = CreateSubscriptionSchema.parse(req.body);
    const tenantId = req.headers['x-tenant-id'] as string;

    if (!tenantId) {
      throw new AppError(400, 'Tenant ID required', 'TENANT_ID_REQUIRED');
    }

    // Get plan details
    const plan = await prisma.subscriptionPlan.findFirst({
      where: { id: planId, tenantId, isActive: true, deletedAt: null },
      include: { meteredPricing: true },
    });

    if (!plan) {
      throw new AppError(404, 'Plan not found', 'PLAN_NOT_FOUND');
    }

    // Get or create Stripe customer
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }

    let stripeCustomerId = user.walletAddress; // Temporary - should store in separate field
    
    // Create Stripe customer if doesn't exist
    const stripeCustomer = await stripeService.createCustomer(user.email, `User ${userId}`);
    stripeCustomerId = stripeCustomer.id;

    // Create Stripe subscription
    const stripeSubscription = await stripeService.createSubscription({
      customerId: stripeCustomerId,
      priceId: plan.stripePriceId!,
      trialPeriodDays: plan.trialDays > 0 ? plan.trialDays : undefined,
      metadata: {
        planId,
        userId,
        tenantId,
      },
    });

    // Create subscription record
    const now = new Date();
    const periodEnd = new Date(stripeSubscription.current_period_end * 1000);
    const subscription = await prisma.subscription.create({
      data: {
        tenantId,
        userId,
        planId,
        stripeSubscriptionId: stripeSubscription.id,
        stripeCustomerId,
        status: stripeSubscription.status === 'trialing' ? 'trialing' : 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        trialStart: plan.trialDays > 0 ? now : null,
        trialEnd: plan.trialDays > 0 ? new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000) : null,
      },
      include: {
        plan: {
          include: { meteredPricing: true },
        },
      },
    });

    // Create usage alerts at 80% and 100%
    for (const pricing of plan.meteredPricing) {
      await prisma.usageAlert.createMany({
        data: [
          {
            subscriptionId: subscription.id,
            tenantId,
            metricType: pricing.metricType,
            threshold: 80,
          },
          {
            subscriptionId: subscription.id,
            tenantId,
            metricType: pricing.metricType,
            threshold: 100,
          },
        ],
      });
    }

    res.status(201).json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/subscriptions
 * List all subscriptions for a tenant
 */
router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.headers['x-tenant-id'] as string;
    const userId = req.query.userId as string | undefined;

    if (!tenantId) {
      throw new AppError(400, 'Tenant ID required', 'TENANT_ID_REQUIRED');
    }

    const subscriptions = await prisma.subscription.findMany({
      where: {
        tenantId,
        userId,
        deletedAt: null,
      },
      include: {
        plan: {
          include: { meteredPricing: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: subscriptions,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/subscriptions/:id
 * Get subscription details with current usage
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.headers['x-tenant-id'] as string;

    if (!tenantId) {
      throw new AppError(400, 'Tenant ID required', 'TENANT_ID_REQUIRED');
    }

    const subscription = await prisma.subscription.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        plan: {
          include: { meteredPricing: true },
        },
        usageRecords: {
          where: {
            timestamp: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
            },
          },
          orderBy: { timestamp: 'desc' },
          take: 100,
        },
      },
    });

    if (!subscription) {
      throw new AppError(404, 'Subscription not found', 'SUBSCRIPTION_NOT_FOUND');
    }

    // Calculate current period usage
    const currentPeriodUsage = await prisma.usageRecord.groupBy({
      by: ['metricType'],
      where: {
        subscriptionId: id,
        timestamp: {
          gte: subscription.currentPeriodStart,
          lte: subscription.currentPeriodEnd,
        },
      },
      _sum: {
        quantity: true,
      },
    });

    res.json({
      success: true,
      data: {
        ...subscription,
        currentPeriodUsage: currentPeriodUsage.map(u => ({
          metricType: u.metricType,
          totalQuantity: u._sum.quantity || 0,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/subscriptions/:id
 * Update subscription (upgrade/downgrade plan or cancel)
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.headers['x-tenant-id'] as string;
    const updates = UpdateSubscriptionSchema.parse(req.body);

    if (!tenantId) {
      throw new AppError(400, 'Tenant ID required', 'TENANT_ID_REQUIRED');
    }

    const subscription = await prisma.subscription.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!subscription) {
      throw new AppError(404, 'Subscription not found', 'SUBSCRIPTION_NOT_FOUND');
    }

    // Handle plan change
    if (updates.planId) {
      const newPlan = await prisma.subscriptionPlan.findFirst({
        where: { id: updates.planId, tenantId, isActive: true, deletedAt: null },
      });

      if (!newPlan) {
        throw new AppError(404, 'New plan not found', 'PLAN_NOT_FOUND');
      }

      // Update Stripe subscription
      if (subscription.stripeSubscriptionId && newPlan.stripePriceId) {
        await stripeService.updateSubscription(subscription.stripeSubscriptionId, {
          items: [{
            id: subscription.stripeSubscriptionId,
            price: newPlan.stripePriceId,
          }],
          proration_behavior: 'create_prorations',
        });
      }

      await prisma.subscription.update({
        where: { id },
        data: { planId: updates.planId },
      });
    }

    // Handle cancellation
    if (updates.cancelAtPeriodEnd !== undefined) {
      if (subscription.stripeSubscriptionId) {
        await stripeService.cancelSubscription(
          subscription.stripeSubscriptionId,
          updates.cancelAtPeriodEnd
        );
      }

      await prisma.subscription.update({
        where: { id },
        data: {
          cancelAtPeriodEnd: updates.cancelAtPeriodEnd,
          canceledAt: updates.cancelAtPeriodEnd ? new Date() : null,
        },
      });
    }

    const updatedSubscription = await prisma.subscription.findUnique({
      where: { id },
      include: { plan: true },
    });

    res.json({
      success: true,
      data: updatedSubscription,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/subscriptions/:id
 * Cancel subscription immediately
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.headers['x-tenant-id'] as string;

    if (!tenantId) {
      throw new AppError(400, 'Tenant ID required', 'TENANT_ID_REQUIRED');
    }

    const subscription = await prisma.subscription.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!subscription) {
      throw new AppError(404, 'Subscription not found', 'SUBSCRIPTION_NOT_FOUND');
    }

    // Cancel in Stripe
    if (subscription.stripeSubscriptionId) {
      await stripeService.cancelSubscription(subscription.stripeSubscriptionId, false);
    }

    // Soft delete
    await prisma.subscription.update({
      where: { id },
      data: {
        status: 'canceled',
        canceledAt: new Date(),
        deletedAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: 'Subscription cancelled',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/subscriptions/:id/usage
 * Record usage for metered billing
 */
router.post('/:id/usage', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.headers['x-tenant-id'] as string;
    const { metricType, quantity, metadata } = RecordUsageSchema.parse(req.body);

    if (!tenantId) {
      throw new AppError(400, 'Tenant ID required', 'TENANT_ID_REQUIRED');
    }

    const subscription = await prisma.subscription.findFirst({
      where: { id, tenantId, deletedAt: null, status: { in: ['active', 'trialing'] } },
      include: { plan: { include: { meteredPricing: true } } },
    });

    if (!subscription) {
      throw new AppError(404, 'Active subscription not found', 'SUBSCRIPTION_NOT_FOUND');
    }

    // Verify metric type is configured for this plan
    const metricConfig = subscription.plan.meteredPricing.find(m => m.metricType === metricType);
    if (!metricConfig) {
      throw new AppError(400, 'Metric type not configured for this plan', 'METRIC_NOT_CONFIGURED');
    }

    // Record usage
    const usageRecord = await prisma.usageRecord.create({
      data: {
        subscriptionId: id,
        tenantId,
        metricType,
        quantity,
        metadata,
        timestamp: new Date(),
      },
    });

    // Check if we need to trigger alerts
    const usageLimits = subscription.plan.usageLimits as Record<string, number> | null;
    if (usageLimits && usageLimits[metricType]) {
      const currentUsage = await prisma.usageRecord.aggregate({
        where: {
          subscriptionId: id,
          metricType,
          timestamp: {
            gte: subscription.currentPeriodStart,
            lte: subscription.currentPeriodEnd,
          },
        },
        _sum: { quantity: true },
      });

      const totalUsage = currentUsage._sum.quantity || 0;
      const limit = usageLimits[metricType];
      const percentage = (totalUsage / limit) * 100;

      // Trigger alerts at 80% and 100%
      for (const threshold of [80, 100]) {
        if (percentage >= threshold) {
          await prisma.usageAlert.updateMany({
            where: {
              subscriptionId: id,
              metricType,
              threshold,
              triggered: false,
            },
            data: {
              triggered: true,
              triggeredAt: new Date(),
            },
          });
        }
      }
    }

    res.status(201).json({
      success: true,
      data: usageRecord,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/subscriptions/:id/usage/summary
 * Get usage summary for current period
 */
router.get('/:id/usage/summary', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.headers['x-tenant-id'] as string;

    if (!tenantId) {
      throw new AppError(400, 'Tenant ID required', 'TENANT_ID_REQUIRED');
    }

    const subscription = await prisma.subscription.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { plan: { include: { meteredPricing: true } } },
    });

    if (!subscription) {
      throw new AppError(404, 'Subscription not found', 'SUBSCRIPTION_NOT_FOUND');
    }

    const usageSummary = await prisma.usageRecord.groupBy({
      by: ['metricType'],
      where: {
        subscriptionId: id,
        timestamp: {
          gte: subscription.currentPeriodStart,
          lte: subscription.currentPeriodEnd,
        },
      },
      _sum: { quantity: true },
    });

    const usageLimits = subscription.plan.usageLimits as Record<string, number> | null;

    const summary = usageSummary.map(u => {
      const totalUsage = u._sum.quantity || 0;
      const limit = usageLimits?.[u.metricType] || 0;
      const percentage = limit > 0 ? (totalUsage / limit) * 100 : 0;

      return {
        metricType: u.metricType,
        totalUsage,
        limit,
        percentage: Math.round(percentage * 100) / 100,
        remaining: Math.max(0, limit - totalUsage),
      };
    });

    res.json({
      success: true,
      data: {
        subscription: {
          id: subscription.id,
          planName: subscription.plan.name,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
        },
        usage: summary,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/subscriptions/:id/invoices
 * Get invoices for a subscription
 */
router.get('/:id/invoices', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.headers['x-tenant-id'] as string;

    if (!tenantId) {
      throw new AppError(400, 'Tenant ID required', 'TENANT_ID_REQUIRED');
    }

    const subscription = await prisma.subscription.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!subscription) {
      throw new AppError(404, 'Subscription not found', 'SUBSCRIPTION_NOT_FOUND');
    }

    const invoices = await prisma.subscriptionInvoice.findMany({
      where: { subscriptionId: id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: invoices,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
