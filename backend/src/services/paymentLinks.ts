import { logger } from '../utils/logger.js';
import {
  paymentLinksService,
  PaymentLinksService,
  type PaymentLinkRecord,
  type PasswordCheckResult,
} from './payment-links.js';

export {
  paymentLinksService,
  PaymentLinksService,
  type PaymentLinkRecord,
  type PasswordCheckResult,
};

export type CheckoutEventType =
  | 'view'
  | 'checkout_started'
  | 'completed'
  | 'abandoned';

export interface CheckoutAnalytics {
  linkId: string;
  slug: string;
  views: number;
  checkoutStarts: number;
  completions: number;
  abandonments: number;
  conversionRate: number;
  abandonmentRate: number;
  totalRevenue: number;
  averageOrderValue: number;
  bySource: Record<string, number>;
  topSource: string | null;
  lastViewedAt: string | null;
  lastCompletedAt: string | null;
}

export interface MerchantCheckoutSummary {
  merchantId: string;
  totalLinks: number;
  activeLinks: number;
  totalViews: number;
  totalCheckoutStarts: number;
  totalCompletions: number;
  overallConversionRate: number;
  totalRevenue: number;
  topPerformingLinkId: string | null;
}

interface CheckoutCounters {
  checkoutStarts: number;
  abandonments: number;
  totalRevenue: number;
}

const checkoutCounters = new Map<string, CheckoutCounters>();

function getOrInitCounters(linkId: string): CheckoutCounters {
  let counters = checkoutCounters.get(linkId);
  if (!counters) {
    counters = { checkoutStarts: 0, abandonments: 0, totalRevenue: 0 };
    checkoutCounters.set(linkId, counters);
  }
  return counters;
}

function roundRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

/**
 * Record a checkout funnel event for a branded payment link and emit a
 * structured observability log.
 */
export function recordCheckoutEvent(
  linkId: string,
  event: CheckoutEventType,
  options: { source?: string; amount?: number } = {},
): CheckoutAnalytics {
  const link = paymentLinksService.getById(linkId);
  if (!link) {
    throw new Error(`Payment link not found: ${linkId}`);
  }

  const source = options.source?.trim() || 'direct';
  const counters = getOrInitCounters(linkId);

  if (event === 'view') {
    paymentLinksService.trackView(link.slug, source);
  } else if (event === 'checkout_started') {
    counters.checkoutStarts += 1;
  } else if (event === 'completed') {
    const amount = options.amount ?? link.amount ?? 0;
    if (amount < 0 || !Number.isFinite(amount)) {
      throw new Error('Checkout completion amount must be a non-negative finite number');
    }
    paymentLinksService.complete(link.slug, source);
    counters.totalRevenue = Math.round((counters.totalRevenue + amount) * 100) / 100;
  } else if (event === 'abandoned') {
    counters.abandonments += 1;
  }

  logger.info('payment_link.checkout_event', {
    linkId,
    slug: link.slug,
    merchantId: link.merchantId,
    event,
    source,
    amount: options.amount,
  });

  return getCheckoutAnalytics(linkId);
}

/**
 * Compute checkout conversion, abandonment, revenue, and attribution metrics
 * for a single payment link.
 */
export function getCheckoutAnalytics(linkId: string): CheckoutAnalytics {
  const link = paymentLinksService.getById(linkId);
  if (!link) {
    throw new Error(`Payment link not found: ${linkId}`);
  }

  const counters = checkoutCounters.get(linkId) ?? {
    checkoutStarts: 0,
    abandonments: 0,
    totalRevenue: 0,
  };
  const { views, completions, bySource, lastViewedAt, lastCompletedAt } =
    link.analytics;

  const topSourceEntry = Object.entries(bySource).sort((a, b) => b[1] - a[1])[0];

  return {
    linkId: link.id,
    slug: link.slug,
    views,
    checkoutStarts: counters.checkoutStarts,
    completions,
    abandonments: counters.abandonments,
    conversionRate: roundRatio(completions, views),
    abandonmentRate: roundRatio(counters.abandonments, counters.checkoutStarts),
    totalRevenue: counters.totalRevenue,
    averageOrderValue:
      completions > 0
        ? Math.round((counters.totalRevenue / completions) * 100) / 100
        : 0,
    bySource: { ...bySource },
    topSource: topSourceEntry ? topSourceEntry[0] : null,
    lastViewedAt,
    lastCompletedAt,
  };
}

/**
 * Aggregate checkout analytics across all payment links owned by a merchant.
 */
export function getMerchantCheckoutSummary(
  merchantId: string,
): MerchantCheckoutSummary {
  const links = paymentLinksService.list({ merchantId });
  let activeLinks = 0;
  let totalViews = 0;
  let totalCheckoutStarts = 0;
  let totalCompletions = 0;
  let totalRevenue = 0;
  let topPerformingLinkId: string | null = null;
  let topRevenue = -1;

  for (const link of links) {
    if (paymentLinksService.isUsable(link)) activeLinks += 1;
    const stats = getCheckoutAnalytics(link.id);
    totalViews += stats.views;
    totalCheckoutStarts += stats.checkoutStarts;
    totalCompletions += stats.completions;
    totalRevenue = Math.round((totalRevenue + stats.totalRevenue) * 100) / 100;
    if (stats.totalRevenue > topRevenue && stats.completions > 0) {
      topRevenue = stats.totalRevenue;
      topPerformingLinkId = link.id;
    }
  }

  return {
    merchantId,
    totalLinks: links.length,
    activeLinks,
    totalViews,
    totalCheckoutStarts,
    totalCompletions,
    overallConversionRate: roundRatio(totalCompletions, totalViews),
    totalRevenue,
    topPerformingLinkId,
  };
}

export function resetCheckoutAnalyticsForTests(): void {
  checkoutCounters.clear();
}
