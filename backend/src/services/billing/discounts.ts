/**
 * discounts.ts — Issue #814
 *
 * Promotional codes and the discounts they grant.
 *
 * A promo code grants either a percentage or a fixed amount off an invoice's
 * subtotal. The discount lasts for a single billing period (`once`), a fixed
 * number of periods (`repeating`) or for the life of the subscription
 * (`forever`). Codes can be restricted by merchant, plan, validity window,
 * total redemptions, redemptions per customer and a minimum plan price.
 */

import { roundMoney } from './money.js';

export type DiscountType = 'percent' | 'fixed';
export type DiscountDuration = 'once' | 'repeating' | 'forever';

export interface PromoCode {
  id: string;
  /** Normalised (upper-case) redemption code, unique across the platform. */
  code: string;
  description?: string;
  merchantId?: string;
  discountType: DiscountType;
  percentOff?: number;
  amountOff?: number;
  currency?: string;
  duration: DiscountDuration;
  durationInPeriods?: number;
  maxRedemptions?: number;
  perCustomerLimit: number;
  appliesToPlanIds?: string[];
  minimumAmount?: number;
  startsAt?: string;
  expiresAt?: string;
  active: boolean;
  timesRedeemed: number;
  createdAt: string;
}

export interface PromoCodeInput {
  code: string;
  description?: string;
  merchantId?: string;
  discountType: DiscountType;
  percentOff?: number;
  amountOff?: number;
  currency?: string;
  duration?: DiscountDuration;
  durationInPeriods?: number;
  maxRedemptions?: number;
  perCustomerLimit?: number;
  appliesToPlanIds?: string[];
  minimumAmount?: number;
  startsAt?: string;
  expiresAt?: string;
}

/** A discount attached to a subscription after a promo code is redeemed. */
export interface AppliedDiscount {
  promoCodeId: string;
  code: string;
  discountType: DiscountType;
  percentOff?: number;
  amountOff?: number;
  currency?: string;
  duration: DiscountDuration;
  /** Billing periods left, including the current one. Undefined for `forever`. */
  remainingPeriods?: number;
  appliedAt: string;
}

export interface RedemptionContext {
  now: number;
  merchantId: string;
  planId: string;
  currency: string;
  planPrice: number;
  customerRedemptions: number;
}

export const PROMO_CODE_PATTERN = /^[A-Z0-9_-]{3,40}$/;

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Returns a validation error for a new promo code, or `null` when valid. */
export function validatePromoCodeInput(input: PromoCodeInput): string | null {
  if (!PROMO_CODE_PATTERN.test(normalizeCode(input.code ?? ''))) {
    return 'code must be 3-40 characters of letters, digits, "-" or "_"';
  }

  if (input.discountType === 'percent') {
    if (!(typeof input.percentOff === 'number' && input.percentOff > 0 && input.percentOff <= 100)) {
      return 'percentOff must be greater than 0 and at most 100';
    }
    if (input.amountOff !== undefined) return 'amountOff cannot be combined with a percent discount';
  } else if (input.discountType === 'fixed') {
    if (!(typeof input.amountOff === 'number' && input.amountOff > 0)) {
      return 'amountOff must be greater than 0';
    }
    if (!input.currency) return 'currency is required for a fixed amount discount';
    if (input.percentOff !== undefined) return 'percentOff cannot be combined with a fixed discount';
  } else {
    return `Unknown discountType ${String(input.discountType)}`;
  }

  const duration = input.duration ?? 'once';
  if (duration === 'repeating') {
    if (!(Number.isInteger(input.durationInPeriods) && (input.durationInPeriods ?? 0) > 0)) {
      return 'durationInPeriods must be a positive integer for a repeating discount';
    }
  } else if (input.durationInPeriods !== undefined) {
    return 'durationInPeriods is only valid for a repeating discount';
  }

  if (input.maxRedemptions !== undefined && !(Number.isInteger(input.maxRedemptions) && input.maxRedemptions > 0)) {
    return 'maxRedemptions must be a positive integer';
  }
  if (
    input.perCustomerLimit !== undefined &&
    !(Number.isInteger(input.perCustomerLimit) && input.perCustomerLimit > 0)
  ) {
    return 'perCustomerLimit must be a positive integer';
  }
  if (input.minimumAmount !== undefined && !(input.minimumAmount >= 0)) {
    return 'minimumAmount cannot be negative';
  }

  const startsAt = input.startsAt ? Date.parse(input.startsAt) : undefined;
  const expiresAt = input.expiresAt ? Date.parse(input.expiresAt) : undefined;
  if (startsAt !== undefined && Number.isNaN(startsAt)) return 'startsAt must be a valid date';
  if (expiresAt !== undefined && Number.isNaN(expiresAt)) return 'expiresAt must be a valid date';
  if (startsAt !== undefined && expiresAt !== undefined && expiresAt <= startsAt) {
    return 'expiresAt must be after startsAt';
  }

  return null;
}

/** Returns why a promo code cannot be redeemed in `ctx`, or `null` if it can. */
export function redemptionError(promo: PromoCode, ctx: RedemptionContext): string | null {
  if (!promo.active) return 'Promo code is inactive';
  if (promo.startsAt && ctx.now < Date.parse(promo.startsAt)) return 'Promo code is not yet valid';
  if (promo.expiresAt && ctx.now >= Date.parse(promo.expiresAt)) return 'Promo code has expired';
  if (promo.maxRedemptions !== undefined && promo.timesRedeemed >= promo.maxRedemptions) {
    return 'Promo code has reached its redemption limit';
  }
  if (ctx.customerRedemptions >= promo.perCustomerLimit) {
    return 'Customer has already redeemed this promo code';
  }
  if (promo.merchantId && promo.merchantId !== ctx.merchantId) {
    return 'Promo code is not valid for this merchant';
  }
  if (promo.appliesToPlanIds && promo.appliesToPlanIds.length > 0 && !promo.appliesToPlanIds.includes(ctx.planId)) {
    return 'Promo code does not apply to this plan';
  }
  if (promo.discountType === 'fixed' && promo.currency !== ctx.currency) {
    return `Promo code currency ${promo.currency} does not match plan currency ${ctx.currency}`;
  }
  if (promo.minimumAmount !== undefined && ctx.planPrice < promo.minimumAmount) {
    return `Plan price is below the promo code minimum of ${promo.minimumAmount}`;
  }
  return null;
}

export function toAppliedDiscount(promo: PromoCode, appliedAt: string): AppliedDiscount {
  return {
    promoCodeId: promo.id,
    code: promo.code,
    discountType: promo.discountType,
    percentOff: promo.percentOff,
    amountOff: promo.amountOff,
    currency: promo.currency,
    duration: promo.duration,
    remainingPeriods:
      promo.duration === 'once' ? 1 : promo.duration === 'repeating' ? promo.durationInPeriods : undefined,
    appliedAt,
  };
}

/** Discount granted on `subtotal`; never negative and never more than the subtotal. */
export function discountAmount(
  discount: Pick<AppliedDiscount, 'discountType' | 'percentOff' | 'amountOff'>,
  subtotal: number,
): number {
  if (subtotal <= 0) return 0;
  const raw =
    discount.discountType === 'percent'
      ? subtotal * ((discount.percentOff ?? 0) / 100)
      : discount.amountOff ?? 0;
  return roundMoney(Math.min(subtotal, Math.max(0, raw)));
}

/** Whether the discount still applies to invoices in the current period. */
export function isDiscountActive(discount: AppliedDiscount | undefined): discount is AppliedDiscount {
  if (!discount) return false;
  return discount.duration === 'forever' || (discount.remainingPeriods ?? 0) > 0;
}
