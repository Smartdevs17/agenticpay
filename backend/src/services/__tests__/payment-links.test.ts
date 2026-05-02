import { beforeEach, describe, expect, it } from 'vitest';
import { paymentLinksService } from '../payment-links.js';

describe('paymentLinksService', () => {
  beforeEach(() => {
    paymentLinksService.resetForTests();
  });

  it('creates a payment link with QR and share URLs', () => {
    const link = paymentLinksService.create({
      merchantId: 'm_1',
      amount: 199.99,
      currency: 'USD',
      description: 'Design retainer',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      recurrence: 'one_time',
      tags: ['design'],
      category: 'services',
    });

    expect(link.slug.length).toBe(16);
    expect(paymentLinksService.getQrCodeUrl(link.slug)).toContain(encodeURIComponent(`/r/${link.slug}`));
    expect(paymentLinksService.getShareLinks(link.slug).url).toContain(link.slug);
  });

  it('tracks views and completions by source', () => {
    const link = paymentLinksService.create({
      merchantId: 'm_2',
      amount: 50,
      currency: 'USD',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      recurrence: 'weekly',
      tags: ['subscription'],
    });

    paymentLinksService.trackView(link.slug, 'twitter');
    paymentLinksService.complete(link.slug, 'twitter');

    const stored = paymentLinksService.getById(link.id);
    expect(stored?.analytics.views).toBe(1);
    expect(stored?.analytics.completions).toBe(1);
    expect(stored?.analytics.bySource.twitter).toBe(2);
    expect(stored?.isActive).toBe(true);
  });

  it('deactivates one-time links on completion', () => {
    const link = paymentLinksService.create({
      merchantId: 'm_3',
      amount: 80,
      currency: 'USD',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      recurrence: 'one_time',
      tags: [],
    });

    paymentLinksService.complete(link.slug);
    const stored = paymentLinksService.getById(link.id);
    expect(stored?.isActive).toBe(false);
  });

  it('supports bulk generation and filtering by tag/category', () => {
    paymentLinksService.bulkCreate('m_4', [
      {
        amount: 10,
        currency: 'USD',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        recurrence: 'one_time',
        tags: ['campaign-a'],
        category: 'email',
      },
      {
        amount: 20,
        currency: 'USD',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        recurrence: 'one_time',
        tags: ['campaign-b'],
        category: 'social',
      },
    ]);

    expect(paymentLinksService.list({ merchantId: 'm_4' })).toHaveLength(2);
    expect(paymentLinksService.list({ merchantId: 'm_4', tag: 'campaign-a' })).toHaveLength(1);
    expect(paymentLinksService.list({ merchantId: 'm_4', category: 'social' })).toHaveLength(1);
  });
});