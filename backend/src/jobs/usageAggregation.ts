import { PrismaClient } from '@prisma/client';
import * as stripeService from '../services/stripe.js';
import { logger } from '../logging/logger.js';

const prisma = new PrismaClient();

/**
 * Aggregate usage records and sync to Stripe
 * Should run hourly via cron job
 */
export async function aggregateUsage(): Promise<void> {
  logger.info('Starting usage aggregation job');

  try {
    // Get all active subscriptions
    const subscriptions = await prisma.subscription.findMany({
      where: {
        status: { in: ['active', 'trialing'] },
        deletedAt: null,
      },
      include: {
        plan: {
          include: { meteredPricing: true },
        },
      },
    });

    logger.info(`Found ${subscriptions.length} active subscriptions`);

    for (const subscription of subscriptions) {
      try {
        await aggregateSubscriptionUsage(subscription.id);
      } catch (error) {
        logger.error(`Failed to aggregate usage for subscription ${subscription.id}`, { error });
      }
    }

    logger.info('Usage aggregation job completed');
  } catch (error) {
    logger.error('Usage aggregation job failed', { error });
    throw error;
  }
}

/**
 * Aggregate usage for a single subscription
 */
async function aggregateSubscriptionUsage(subscriptionId: string): Promise<void> {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      plan: {
        include: { meteredPricing: true },
      },
    },
  });

  if (!subscription) {
    return;
  }

  // Get unaggregated usage records
  const usageRecords = await prisma.usageRecord.findMany({
    where: {
      subscriptionId,
      aggregatedAt: null,
      timestamp: {
        gte: subscription.currentPeriodStart,
        lte: subscription.currentPeriodEnd,
      },
    },
  });

  if (usageRecords.length === 0) {
    return;
  }

  // Group by metric type
  const usageByMetric = usageRecords.reduce((acc, record) => {
    if (!acc[record.metricType]) {
      acc[record.metricType] = [];
    }
    acc[record.metricType].push(record);
    return acc;
  }, {} as Record<string, typeof usageRecords>);

  // Process each metric type
  for (const [metricType, records] of Object.entries(usageByMetric)) {
    const totalQuantity = records.reduce((sum, r) => sum + r.quantity, 0);

    // Find pricing config
    const pricingConfig = subscription.plan.meteredPricing.find(
      m => m.metricType === metricType
    );

    if (!pricingConfig) {
      logger.warn(`No pricing config found for metric ${metricType}`);
      continue;
    }

    // Calculate cost based on tiered pricing
    const cost = calculateCost(totalQuantity, pricingConfig);

    // Create or update aggregate
    const periodStart = subscription.currentPeriodStart;
    const periodEnd = new Date();

    await prisma.usageAggregate.upsert({
      where: {
        subscriptionId_metricType_periodStart: {
          subscriptionId,
          metricType: metricType as any,
          periodStart,
        },
      },
      create: {
        subscriptionId,
        tenantId: subscription.tenantId,
        metricType: metricType as any,
        totalQuantity,
        periodStart,
        periodEnd,
        cost,
        currency: pricingConfig.currency,
      },
      update: {
        totalQuantity: { increment: totalQuantity },
        periodEnd,
        cost: { increment: cost },
      },
    });

    // Mark records as aggregated
    await prisma.usageRecord.updateMany({
      where: {
        id: { in: records.map(r => r.id) },
      },
      data: {
        aggregatedAt: new Date(),
      },
    });

    // Sync to Stripe if subscription has Stripe ID
    if (subscription.stripeSubscriptionId && pricingConfig.stripeMeterId) {
      try {
        await stripeService.recordUsage({
          subscriptionItemId: pricingConfig.stripeMeterId,
          quantity: totalQuantity,
          action: 'increment',
        });
        logger.info(`Synced ${totalQuantity} units of ${metricType} to Stripe`);
      } catch (error) {
        logger.error(`Failed to sync usage to Stripe`, { error, subscriptionId, metricType });
      }
    }
  }
}

/**
 * Calculate cost based on tiered pricing
 */
function calculateCost(quantity: number, pricing: any): number {
  const includedUnits = pricing.includedUnits || 0;
  const billableQuantity = Math.max(0, quantity - includedUnits);

  if (billableQuantity === 0) {
    return 0;
  }

  // If no tiers, use flat unit price
  if (!pricing.tiers || pricing.tiers.length === 0) {
    return billableQuantity * Number(pricing.unitPrice);
  }

  // Calculate with tiered pricing
  let cost = 0;
  let remaining = billableQuantity;
  let previousTier = 0;

  for (const tier of pricing.tiers) {
    const tierLimit = tier.upTo || Infinity;
    const tierSize = tierLimit - previousTier;
    const unitsInTier = Math.min(remaining, tierSize);

    cost += unitsInTier * tier.price;
    remaining -= unitsInTier;

    if (remaining <= 0) {
      break;
    }

    previousTier = tierLimit;
  }

  return cost;
}

/**
 * Check usage alerts and send notifications
 * Should run hourly via cron job
 */
export async function checkUsageAlerts(): Promise<void> {
  logger.info('Starting usage alerts check');

  try {
    const activeSubscriptions = await prisma.subscription.findMany({
      where: {
        status: { in: ['active', 'trialing'] },
        deletedAt: null,
      },
      include: {
        plan: true,
      },
    });

    for (const subscription of activeSubscriptions) {
      const usageLimits = subscription.plan.usageLimits as Record<string, number> | null;
      if (!usageLimits) {
        continue;
      }

      // Get current usage by metric
      const currentUsage = await prisma.usageRecord.groupBy({
        by: ['metricType'],
        where: {
          subscriptionId: subscription.id,
          timestamp: {
            gte: subscription.currentPeriodStart,
            lte: subscription.currentPeriodEnd,
          },
        },
        _sum: { quantity: true },
      });

      // Check each metric against limits
      for (const usage of currentUsage) {
        const limit = usageLimits[usage.metricType];
        if (!limit) {
          continue;
        }

        const totalUsage = usage._sum.quantity || 0;
        const percentage = (totalUsage / limit) * 100;

        // Trigger alerts at 80% and 100%
        for (const threshold of [80, 100]) {
          if (percentage >= threshold) {
            const alert = await prisma.usageAlert.findUnique({
              where: {
                subscriptionId_metricType_threshold: {
                  subscriptionId: subscription.id,
                  metricType: usage.metricType,
                  threshold,
                },
              },
            });

            if (alert && !alert.triggered) {
              await prisma.usageAlert.update({
                where: { id: alert.id },
                data: {
                  triggered: true,
                  triggeredAt: new Date(),
                },
              });

              // TODO: Send notification email/webhook
              logger.info(`Usage alert triggered: ${usage.metricType} at ${threshold}%`, {
                subscriptionId: subscription.id,
                totalUsage,
                limit,
              });
            }
          }
        }
      }
    }

    logger.info('Usage alerts check completed');
  } catch (error) {
    logger.error('Usage alerts check failed', { error });
    throw error;
  }
}

/**
 * Process failed payments and dunning
 * Should run daily via cron job
 */
export async function processDunning(): Promise<void> {
  logger.info('Starting dunning process');

  try {
    const pastDueSubscriptions = await prisma.subscription.findMany({
      where: {
        status: 'past_due',
        deletedAt: null,
      },
      include: {
        plan: true,
        invoices: {
          where: { status: { in: ['open', 'uncollectible'] } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    for (const subscription of pastDueSubscriptions) {
      const gracePeriodDays = subscription.plan.gracePeriodDays || 3;
      const gracePeriodEnd = new Date(
        subscription.currentPeriodEnd.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000
      );

      const now = new Date();

      if (now > gracePeriodEnd) {
        // Grace period expired - suspend subscription
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: 'unpaid',
            canceledAt: now,
          },
        });

        logger.info(`Subscription ${subscription.id} suspended after grace period`);
      } else {
        // Within grace period - retry payment
        const latestInvoice = subscription.invoices[0];
        if (latestInvoice && latestInvoice.stripeInvoiceId) {
          try {
            const paidInvoice = await stripeService.payInvoice(latestInvoice.stripeInvoiceId);

            if (paidInvoice.status === 'paid') {
              await prisma.subscriptionInvoice.update({
                where: { id: latestInvoice.id },
                data: {
                  status: 'paid',
                  paidAt: new Date(),
                },
              });

              await prisma.subscription.update({
                where: { id: subscription.id },
                data: { status: 'active' },
              });

              logger.info(`Payment successful for subscription ${subscription.id}`);
            }
          } catch (error) {
            // Payment failed - increment attempt count
            await prisma.subscriptionInvoice.update({
              where: { id: latestInvoice.id },
              data: {
                attemptCount: { increment: 1 },
                nextPaymentAttempt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Retry in 24 hours
              },
            });

            logger.warn(`Payment retry failed for subscription ${subscription.id}`, { error });
          }
        }
      }
    }

    logger.info('Dunning process completed');
  } catch (error) {
    logger.error('Dunning process failed', { error });
    throw error;
  }
}
