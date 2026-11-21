import { beforeEach, describe, expect, it } from 'vitest';
import { paymentLinksService } from '../payment-links.js';

describe('Payment Links Analytics & A/B Testing', () => {
  beforeEach(() => {
    paymentLinksService.resetForTests();
  });

  it('calculates conversion rate and total revenue accurately', () => {
    const link = paymentLinksService.create({
      merchantId: 'm_analytics_1',
      amount: 100,
      currency: 'USD',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrence: 'weekly',
      tags: ['ecommerce'],
    });

    // 4 views, 2 completions
    paymentLinksService.trackView(link.slug, 'google');
    paymentLinksService.trackView(link.slug, 'facebook');
    paymentLinksService.trackView(link.slug, 'direct');
    paymentLinksService.trackView(link.slug, 'direct');

    paymentLinksService.complete(link.slug, 'google', undefined, 100);
    paymentLinksService.complete(link.slug, 'facebook', undefined, 100);

    const updated = paymentLinksService.getById(link.id)!;
    expect(updated.analytics.views).toBe(4);
    expect(updated.analytics.completions).toBe(2);
    expect(updated.analytics.conversionRate).toBe(50); // 50%
    expect(updated.analytics.totalRevenue).toBe(200);
    expect(updated.analytics.bySource.google).toBe(2);
    expect(updated.analytics.bySource.facebook).toBe(2);
    expect(updated.analytics.bySource.direct).toBe(2);
  });

  it('handles A/B testing variants and tracks per-variant conversion rates', () => {
    const link = paymentLinksService.create({
      merchantId: 'm_ab_1',
      amount: 50,
      currency: 'USD',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrence: 'weekly',
      tags: ['ab-test'],
      variants: [
        { id: 'var_a', name: 'Original Price', amount: 50, weight: 50 },
        { id: 'var_b', name: 'Discount Promo', amount: 40, weight: 50, ctaText: 'Claim Discount' },
      ],
    });

    expect(link.variants).toHaveLength(2);
    expect(link.analytics.variantAnalytics.var_a).toBeDefined();
    expect(link.analytics.variantAnalytics.var_b).toBeDefined();

    // Select explicit variant
    const selectedA = paymentLinksService.selectVariant(link, 'var_a');
    expect(selectedA?.id).toBe('var_a');

    const selectedB = paymentLinksService.selectVariant(link, 'var_b');
    expect(selectedB?.id).toBe('var_b');
    expect(selectedB?.ctaText).toBe('Claim Discount');

    // Simulate views & completions for Variant A
    paymentLinksService.trackView(link.slug, 'newsletter', 'var_a');
    paymentLinksService.trackView(link.slug, 'newsletter', 'var_a');
    paymentLinksService.complete(link.slug, 'newsletter', 'var_a', 50);

    // Simulate views & completions for Variant B
    paymentLinksService.trackView(link.slug, 'social', 'var_b');
    paymentLinksService.trackView(link.slug, 'social', 'var_b');
    paymentLinksService.trackView(link.slug, 'social', 'var_b');
    paymentLinksService.complete(link.slug, 'social', 'var_b', 40);
    paymentLinksService.complete(link.slug, 'social', 'var_b', 40);

    const updated = paymentLinksService.getById(link.id)!;
    expect(updated.analytics.variantAnalytics.var_a.views).toBe(2);
    expect(updated.analytics.variantAnalytics.var_a.completions).toBe(1);
    expect(updated.analytics.variantAnalytics.var_a.totalRevenue).toBe(50);
    expect(updated.analytics.variantAnalytics.var_a.conversionRate).toBe(50);

    expect(updated.analytics.variantAnalytics.var_b.views).toBe(3);
    expect(updated.analytics.variantAnalytics.var_b.completions).toBe(2);
    expect(updated.analytics.variantAnalytics.var_b.totalRevenue).toBe(80);
    expect(updated.analytics.variantAnalytics.var_b.conversionRate).toBe(66.67);
  });

  it('records individual conversion logs', () => {
    const link = paymentLinksService.create({
      merchantId: 'm_conv_1',
      amount: 150,
      currency: 'USD',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrence: 'weekly',
      tags: ['sub'],
    });

    paymentLinksService.complete(link.slug, 'twitter', undefined, 150, {
      referrer: 'https://t.co/xyz',
      userAgent: 'Mozilla/5.0',
    });

    const conversions = paymentLinksService.getConversions(link.id);
    expect(conversions).toHaveLength(1);
    expect(conversions[0].amount).toBe(150);
    expect(conversions[0].source).toBe('twitter');
    expect(conversions[0].referrer).toBe('https://t.co/xyz');
  });

  it('aggregates merchant-level dashboard summary metrics', () => {
    paymentLinksService.create({
      merchantId: 'm_summary_1',
      amount: 100,
      currency: 'USD',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrence: 'weekly',
      tags: [],
    });

    const link2 = paymentLinksService.create({
      merchantId: 'm_summary_1',
      amount: 200,
      currency: 'USD',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrence: 'weekly',
      tags: [],
    });

    paymentLinksService.trackView(link2.slug);
    paymentLinksService.complete(link2.slug, 'direct', undefined, 200);

    const summary = paymentLinksService.getMerchantDashboardSummary('m_summary_1');
    expect(summary.totalLinks).toBe(2);
    expect(summary.activeLinks).toBe(2);
    expect(summary.totalCompletions).toBe(1);
    expect(summary.totalRevenue).toBe(200);
    expect(summary.topLinks).toHaveLength(2);
  });

  it('generates QR code data URL and enhanced share links with UTM & embed code', async () => {
    const link = paymentLinksService.create({
      merchantId: 'm_qr_1',
      amount: 75,
      currency: 'USD',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrence: 'one_time',
      tags: [],
    });

    const dataUrl = await paymentLinksService.getQrCodeDataUrl(link.slug);
    expect(dataUrl.length).toBeGreaterThan(10);
    expect(dataUrl).toMatch(/^(data:image\/png;base64|https:\/\/)/);

    const svg = await paymentLinksService.getQrCodeDataUrl(link.slug, 'svg');
    expect(svg).toContain('<svg');

    const share = paymentLinksService.getShareLinks(link.slug, 'var_1', 'campaign_x');
    expect(share.url).toContain('variant=var_1');
    expect(share.url).toContain('source=campaign_x');
    expect(share.linkedin).toContain('linkedin.com');
    expect(share.telegram).toContain('t.me');
    expect(share.embedCode).toContain('<iframe');
  });
});
