import { describe, expect, it } from 'vitest';
import {
  PromoCode,
  RedemptionContext,
  discountAmount,
  isDiscountActive,
  redemptionError,
  toAppliedDiscount,
  validatePromoCodeInput,
} from '../discounts.js';

const now = new Date('2026-02-01T00:00:00.000Z').getTime();

const promo = (overrides: Partial<PromoCode> = {}): PromoCode => ({
  id: 'promo_1',
  code: 'SAVE20',
  discountType: 'percent',
  percentOff: 20,
  duration: 'once',
  perCustomerLimit: 1,
  active: true,
  timesRedeemed: 0,
  createdAt: new Date(now).toISOString(),
  ...overrides,
});

const ctx = (overrides: Partial<RedemptionContext> = {}): RedemptionContext => ({
  now,
  merchantId: 'm1',
  planId: 'plan_pro',
  currency: 'USD',
  planPrice: 49,
  customerRedemptions: 0,
  ...overrides,
});

describe('promo code discounts (#814)', () => {
  describe('validatePromoCodeInput', () => {
    it('accepts valid percent and fixed codes', () => {
      expect(validatePromoCodeInput({ code: 'save20', discountType: 'percent', percentOff: 20 })).toBeNull();
      expect(
        validatePromoCodeInput({
          code: 'TEN-OFF',
          discountType: 'fixed',
          amountOff: 10,
          currency: 'USD',
          duration: 'repeating',
          durationInPeriods: 3,
        }),
      ).toBeNull();
    });

    it('rejects malformed input', () => {
      expect(validatePromoCodeInput({ code: 'a!', discountType: 'percent', percentOff: 10 })).toMatch(/code must be/);
      expect(validatePromoCodeInput({ code: 'BIG', discountType: 'percent', percentOff: 120 })).toMatch(/percentOff/);
      expect(validatePromoCodeInput({ code: 'FLAT', discountType: 'fixed', amountOff: 5 })).toMatch(
        /currency is required/,
      );
      expect(
        validatePromoCodeInput({ code: 'REP', discountType: 'percent', percentOff: 10, duration: 'repeating' }),
      ).toMatch(/durationInPeriods/);
      expect(
        validatePromoCodeInput({ code: 'ONCE', discountType: 'percent', percentOff: 10, durationInPeriods: 2 }),
      ).toMatch(/only valid for a repeating/);
      expect(
        validatePromoCodeInput({
          code: 'WINDOW',
          discountType: 'percent',
          percentOff: 10,
          startsAt: '2026-03-01T00:00:00.000Z',
          expiresAt: '2026-02-01T00:00:00.000Z',
        }),
      ).toMatch(/expiresAt must be after startsAt/);
    });
  });

  describe('redemptionError', () => {
    it('allows a valid redemption', () => {
      expect(redemptionError(promo(), ctx())).toBeNull();
    });

    it.each([
      [{ active: false }, {}, /inactive/],
      [{ startsAt: '2026-03-01T00:00:00.000Z' }, {}, /not yet valid/],
      [{ expiresAt: '2026-02-01T00:00:00.000Z' }, {}, /expired/],
      [{ maxRedemptions: 5, timesRedeemed: 5 }, {}, /redemption limit/],
      [{}, { customerRedemptions: 1 }, /already redeemed/],
      [{ merchantId: 'm2' }, {}, /not valid for this merchant/],
      [{ appliesToPlanIds: ['plan_basic'] }, {}, /does not apply to this plan/],
      [{ discountType: 'fixed', percentOff: undefined, amountOff: 5, currency: 'EUR' }, {}, /currency EUR/],
      [{ minimumAmount: 100 }, {}, /below the promo code minimum/],
    ] as const)('rejects %o with context %o', (promoOverrides, ctxOverrides, message) => {
      expect(redemptionError(promo(promoOverrides as Partial<PromoCode>), ctx(ctxOverrides))).toMatch(message);
    });
  });

  describe('discountAmount', () => {
    it('applies a percentage to the subtotal', () => {
      expect(discountAmount({ discountType: 'percent', percentOff: 20 }, 49)).toBe(9.8);
    });

    it('caps a fixed discount at the subtotal', () => {
      expect(discountAmount({ discountType: 'fixed', amountOff: 10 }, 5)).toBe(5);
      expect(discountAmount({ discountType: 'fixed', amountOff: 10 }, 0)).toBe(0);
    });
  });

  describe('applied discounts', () => {
    it('derives the number of periods from the duration', () => {
      const at = new Date(now).toISOString();
      expect(toAppliedDiscount(promo(), at).remainingPeriods).toBe(1);
      expect(toAppliedDiscount(promo({ duration: 'repeating', durationInPeriods: 3 }), at).remainingPeriods).toBe(3);
      expect(toAppliedDiscount(promo({ duration: 'forever' }), at).remainingPeriods).toBeUndefined();
    });

    it('reports whether a discount is still active', () => {
      const at = new Date(now).toISOString();
      expect(isDiscountActive(undefined)).toBe(false);
      expect(isDiscountActive(toAppliedDiscount(promo({ duration: 'forever' }), at))).toBe(true);
      expect(isDiscountActive({ ...toAppliedDiscount(promo(), at), remainingPeriods: 0 })).toBe(false);
    });
  });
});
