import { describe, expect, it } from 'vitest';
import { renderHostedCheckoutPage } from './payment-links.js';
import type { PaymentLinkRecord } from '../services/payment-links.js';

function makeLink(overrides: Partial<PaymentLinkRecord> = {}): PaymentLinkRecord {
  return {
    id: 'link_1',
    merchantId: 'merchant_1',
    slug: 'safeSlug12345678',
    amount: 49.99,
    currency: 'USD',
    description: 'Secure checkout link',
    expiresAt: '2030-01-01T00:00:00.000Z',
    recurrence: 'one_time',
    tags: [],
    requiresPassword: false,
    maxUses: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    analytics: {
      views: 0,
      completions: 0,
      bySource: {},
      lastViewedAt: null,
      lastCompletedAt: null,
    },
    ...overrides,
  };
}

describe('renderHostedCheckoutPage', () => {
  it('escapes merchant-controlled text in the hosted checkout', () => {
    const html = renderHostedCheckoutPage(
      makeLink({
        description: '<script>alert("owned")</script>',
        brand: {
          brandName: '<img src=x onerror=alert(1)>',
          accentColor: '#0052FF',
          redirectUrl: 'https://merchant.example/thanks',
        },
      })
    );

    expect(html).not.toContain('<script>alert("owned")</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;alert(&quot;owned&quot;)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renders a password unlock form before showing the completion action', () => {
    const lockedHtml = renderHostedCheckoutPage(
      makeLink({
        requiresPassword: true,
      }),
      { source: 'qr' }
    );
    const unlockedHtml = renderHostedCheckoutPage(
      makeLink({
        requiresPassword: true,
      }),
      { source: 'qr', password: 'open-sesame' }
    );

    expect(lockedHtml).toContain('Payment password');
    expect(lockedHtml).toContain('Unlock checkout');
    expect(lockedHtml).not.toContain('Complete payment');
    expect(unlockedHtml).toContain('Complete payment');
  });

  it('keeps the completion action hidden after a bad password attempt', () => {
    const html = renderHostedCheckoutPage(
      makeLink({
        requiresPassword: true,
      }),
      {
        source: 'qr',
        password: 'wrong-password',
        passwordError: 'That password did not match this payment link.',
      }
    );

    expect(html).toContain('That password did not match this payment link.');
    expect(html).not.toContain('Complete payment');
  });
});
