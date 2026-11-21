/**
 * metered-pricing.ts — Issue #815
 *
 * Usage-based pricing for individual meters. A plan can attach one metered
 * price per metric; each meter aggregates the period's usage events
 * (sum / max / last), subtracts its free allowance and prices the remaining
 * billable units with one of four models:
 *
 * - `per_unit`  — every billable unit costs `unitPrice`.
 * - `package`   — units are sold in bundles of `packageSize`, rounded up.
 * - `graduated` — each tier prices only the units that fall inside it.
 * - `volume`    — the tier reached by the total prices *all* units.
 *
 * Tier boundaries (`upTo`) count billable units, i.e. usage after the meter's
 * `includedUnits` have been consumed. The last tier must be open-ended
 * (`upTo: null`) so every quantity has a price.
 */

import { roundMoney } from './money.js';

export type MeterAggregation = 'sum' | 'max' | 'last';
export type MeteredPricingModel = 'per_unit' | 'package' | 'graduated' | 'volume';

export interface MeterTier {
  /** Inclusive upper bound in billable units; `null` means "and above". */
  upTo: number | null;
  unitPrice: number;
  /** Optional flat fee charged once when usage enters this tier. */
  flatFee?: number;
}

export interface MeteredPrice {
  metric: string;
  displayName?: string;
  aggregation: MeterAggregation;
  model: MeteredPricingModel;
  includedUnits: number;
  unitPrice?: number;
  packageSize?: number;
  packagePrice?: number;
  tiers?: MeterTier[];
}

export interface MeterReading {
  sum: number;
  max: number;
  last: number;
  count: number;
}

export interface MeterCharge {
  metric: string;
  description: string;
  aggregation: MeterAggregation;
  model: MeteredPricingModel;
  /** Aggregated quantity for the period. */
  quantity: number;
  includedUnits: number;
  billableUnits: number;
  amount: number;
}

export const METER_AGGREGATIONS: readonly MeterAggregation[] = ['sum', 'max', 'last'];
export const METERED_PRICING_MODELS: readonly MeteredPricingModel[] = [
  'per_unit',
  'package',
  'graduated',
  'volume',
];

/** Returns a human readable validation error, or `null` when the price is valid. */
export function validateMeteredPrice(price: MeteredPrice): string | null {
  if (!price.metric?.trim()) return 'Meter metric is required';
  if (!METER_AGGREGATIONS.includes(price.aggregation)) {
    return `Meter ${price.metric}: unknown aggregation ${price.aggregation}`;
  }
  if (!(price.includedUnits >= 0)) return `Meter ${price.metric}: includedUnits cannot be negative`;

  switch (price.model) {
    case 'per_unit':
      if (!(typeof price.unitPrice === 'number' && price.unitPrice >= 0)) {
        return `Meter ${price.metric}: per_unit pricing requires a non-negative unitPrice`;
      }
      return null;
    case 'package':
      if (!(typeof price.packageSize === 'number' && Number.isInteger(price.packageSize) && price.packageSize > 0)) {
        return `Meter ${price.metric}: packageSize must be a positive integer`;
      }
      if (!(typeof price.packagePrice === 'number' && price.packagePrice >= 0)) {
        return `Meter ${price.metric}: packagePrice cannot be negative`;
      }
      return null;
    case 'graduated':
    case 'volume':
      return validateTiers(price.metric, price.tiers);
    default:
      return `Meter ${price.metric}: unknown pricing model ${String(price.model)}`;
  }
}

function validateTiers(metric: string, tiers: MeterTier[] | undefined): string | null {
  if (!tiers || tiers.length === 0) return `Meter ${metric}: tiered pricing requires at least one tier`;

  let previous = 0;
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const isLast = i === tiers.length - 1;
    if (!(tier.unitPrice >= 0)) return `Meter ${metric}: tier unitPrice cannot be negative`;
    if ((tier.flatFee ?? 0) < 0) return `Meter ${metric}: tier flatFee cannot be negative`;
    if (tier.upTo === null) {
      if (!isLast) return `Meter ${metric}: only the last tier can be open-ended`;
      continue;
    }
    if (isLast) return `Meter ${metric}: the last tier must be open-ended (upTo: null)`;
    if (!(tier.upTo > previous)) return `Meter ${metric}: tiers must be sorted by ascending upTo`;
    previous = tier.upTo;
  }
  return null;
}

/** Fold a usage event into the running reading for a meter. */
export function applyReading(reading: MeterReading | undefined, quantity: number): MeterReading {
  if (!reading) return { sum: quantity, max: quantity, last: quantity, count: 1 };
  return {
    sum: reading.sum + quantity,
    max: Math.max(reading.max, quantity),
    last: quantity,
    count: reading.count + 1,
  };
}

export function aggregateReading(reading: MeterReading | undefined, aggregation: MeterAggregation): number {
  if (!reading) return 0;
  return reading[aggregation];
}

/** Price a meter's aggregated quantity for one billing period. */
export function priceMeteredUsage(price: MeteredPrice, quantity: number): MeterCharge {
  const billableUnits = Math.max(0, quantity - price.includedUnits);

  let amount = 0;
  if (billableUnits > 0) {
    switch (price.model) {
      case 'per_unit':
        amount = billableUnits * (price.unitPrice ?? 0);
        break;
      case 'package':
        amount = Math.ceil(billableUnits / (price.packageSize ?? 1)) * (price.packagePrice ?? 0);
        break;
      case 'graduated':
        amount = priceGraduated(price.tiers ?? [], billableUnits);
        break;
      case 'volume':
        amount = priceVolume(price.tiers ?? [], billableUnits);
        break;
    }
  }

  return {
    metric: price.metric,
    description: `Metered usage — ${price.displayName ?? price.metric}`,
    aggregation: price.aggregation,
    model: price.model,
    quantity,
    includedUnits: price.includedUnits,
    billableUnits,
    amount: roundMoney(amount),
  };
}

function priceGraduated(tiers: MeterTier[], units: number): number {
  let remaining = units;
  let cursor = 0;
  let amount = 0;

  for (const tier of tiers) {
    if (remaining <= 0) break;
    const ceiling = tier.upTo ?? Number.POSITIVE_INFINITY;
    const span = Math.min(remaining, ceiling - cursor);
    if (span <= 0) continue;
    amount += span * tier.unitPrice + (tier.flatFee ?? 0);
    remaining -= span;
    cursor += span;
  }

  return amount;
}

function priceVolume(tiers: MeterTier[], units: number): number {
  const tier = tiers.find((t) => t.upTo === null || units <= t.upTo) ?? tiers[tiers.length - 1];
  return units * tier.unitPrice + (tier.flatFee ?? 0);
}
