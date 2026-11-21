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

  describe('password protection', () => {
    function makeProtected(password = 'hunter2') {
      return paymentLinksService.create({
        merchantId: 'm_pw',
        amount: 100,
        currency: 'USD',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        recurrence: 'one_time',
        tags: [],
        password,
      });
    }

    it('flags the link as protected without storing the password', () => {
      const link = makeProtected();
      expect(link.requiresPassword).toBe(true);
      // The plaintext password must not appear anywhere on the public record.
      expect(JSON.stringify(link)).not.toContain('hunter2');
    });

    it('accepts the correct password and rejects an incorrect one', () => {
      const link = makeProtected();
      expect(paymentLinksService.verifyPassword(link.slug, 'hunter2')).toEqual({ ok: true });
      expect(paymentLinksService.verifyPassword(link.slug, 'wrong')).toMatchObject({
        ok: false,
        reason: 'invalid_password',
      });
    });

    it('locks the link after repeated incorrect attempts', () => {
      const link = makeProtected();
      for (let i = 0; i < 4; i++) {
        expect(paymentLinksService.verifyPassword(link.slug, 'wrong')).toMatchObject({
          ok: false,
          reason: 'invalid_password',
        });
      }
      // 5th failure trips the lockout.
      const locked = paymentLinksService.verifyPassword(link.slug, 'wrong');
      expect(locked.ok).toBe(false);
      expect(locked).toMatchObject({ reason: 'locked' });
      // Even the correct password is refused while locked.
      expect(paymentLinksService.verifyPassword(link.slug, 'hunter2')).toMatchObject({
        ok: false,
        reason: 'locked',
      });
    });

    it('returns no_password_required for unprotected links', () => {
      const link = paymentLinksService.create({
        merchantId: 'm_pw2',
        amount: 5,
        currency: 'USD',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        recurrence: 'one_time',
        tags: [],
      });
      expect(paymentLinksService.verifyPassword(link.slug, 'anything')).toMatchObject({
        ok: false,
        reason: 'no_password_required',
      });
    });
  });

  describe('maximum usage limit', () => {
    it('disables the link once the completion cap is reached', () => {
      const link = paymentLinksService.create({
        merchantId: 'm_cap',
        amount: 25,
        currency: 'USD',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        recurrence: 'weekly',
        tags: [],
        maxUses: 2,
      });

      paymentLinksService.complete(link.slug);
      expect(paymentLinksService.isUsable(paymentLinksService.getById(link.id)!)).toBe(true);

      paymentLinksService.complete(link.slug);
      const stored = paymentLinksService.getById(link.id)!;
      expect(stored.analytics.completions).toBe(2);
      expect(paymentLinksService.hasReachedUsageLimit(stored)).toBe(true);
      expect(stored.isActive).toBe(false);
      expect(paymentLinksService.isUsable(stored)).toBe(false);
    });

    it('treats links without maxUses as unlimited', () => {
      const link = paymentLinksService.create({
        merchantId: 'm_cap2',
        amount: 25,
        currency: 'USD',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        recurrence: 'weekly',
        tags: [],
      });
      for (let i = 0; i < 10; i++) paymentLinksService.complete(link.slug);
      const stored = paymentLinksService.getById(link.id)!;
      expect(stored.maxUses).toBeNull();
      expect(paymentLinksService.hasReachedUsageLimit(stored)).toBe(false);
      expect(stored.isActive).toBe(true);
    });
  });
});