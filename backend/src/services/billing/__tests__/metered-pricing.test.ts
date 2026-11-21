import { describe, expect, it } from 'vitest';
import {
  MeteredPrice,
  aggregateReading,
  applyReading,
  priceMeteredUsage,
  validateMeteredPrice,
} from '../metered-pricing.js';

const meter = (overrides: Partial<MeteredPrice> = {}): MeteredPrice => ({
  metric: 'api_calls',
  aggregation: 'sum',
  model: 'per_unit',
  includedUnits: 0,
  unitPrice: 0.01,
  ...overrides,
});

const tiers = [
  { upTo: 100, unitPrice: 0.1 },
  { upTo: 500, unitPrice: 0.05 },
  { upTo: null, unitPrice: 0.01 },
];

describe('metered pricing (#815)', () => {
  describe('priceMeteredUsage', () => {
    it('charges per unit beyond the included allowance', () => {
      const charge = priceMeteredUsage(meter({ includedUnits: 100, unitPrice: 0.5 }), 150);
      expect(charge).toMatchObject({ quantity: 150, billableUnits: 50, amount: 25 });
    });

    it('charges nothing when usage is within the allowance', () => {
      const charge = priceMeteredUsage(meter({ includedUnits: 100 }), 80);
      expect(charge.billableUnits).toBe(0);
      expect(charge.amount).toBe(0);
    });

    it('rounds package pricing up to whole packages', () => {
      const charge = priceMeteredUsage(
        meter({ model: 'package', unitPrice: undefined, packageSize: 100, packagePrice: 5 }),
        250,
      );
      expect(charge.amount).toBe(15);
    });

    it('prices graduated tiers progressively', () => {
      // 100 * 0.1 + 400 * 0.05 + 500 * 0.01 = 10 + 20 + 5
      const charge = priceMeteredUsage(meter({ model: 'graduated', tiers }), 1_000);
      expect(charge.amount).toBe(35);
    });

    it('applies tier flat fees once per tier entered', () => {
      const charge = priceMeteredUsage(
        meter({
          model: 'graduated',
          tiers: [
            { upTo: 10, unitPrice: 0, flatFee: 5 },
            { upTo: null, unitPrice: 1 },
          ],
        }),
        15,
      );
      expect(charge.amount).toBe(10);
    });

    it('prices every unit at the tier reached for volume pricing', () => {
      const price = meter({ model: 'volume', tiers });
      expect(priceMeteredUsage(price, 100).amount).toBe(10); // boundary is inclusive
      expect(priceMeteredUsage(price, 300).amount).toBe(15);
      expect(priceMeteredUsage(price, 1_000).amount).toBe(10);
    });

    it('counts tier boundaries in billable units after the allowance', () => {
      const charge = priceMeteredUsage(meter({ model: 'graduated', includedUnits: 50, tiers }), 150);
      expect(charge.billableUnits).toBe(100);
      expect(charge.amount).toBe(10);
    });

    it('uses the display name in the line description', () => {
      expect(priceMeteredUsage(meter({ displayName: 'API calls' }), 1).description).toBe(
        'Metered usage — API calls',
      );
    });
  });

  describe('readings', () => {
    it('tracks sum, max, last and count', () => {
      let reading = applyReading(undefined, 5);
      reading = applyReading(reading, 12);
      reading = applyReading(reading, 3);

      expect(reading).toEqual({ sum: 20, max: 12, last: 3, count: 3 });
      expect(aggregateReading(reading, 'sum')).toBe(20);
      expect(aggregateReading(reading, 'max')).toBe(12);
      expect(aggregateReading(reading, 'last')).toBe(3);
    });

    it('treats a missing reading as zero usage', () => {
      expect(aggregateReading(undefined, 'max')).toBe(0);
    });
  });

  describe('validateMeteredPrice', () => {
    it('accepts valid prices for every model', () => {
      expect(validateMeteredPrice(meter())).toBeNull();
      expect(validateMeteredPrice(meter({ model: 'package', packageSize: 10, packagePrice: 1 }))).toBeNull();
      expect(validateMeteredPrice(meter({ model: 'graduated', tiers }))).toBeNull();
      expect(validateMeteredPrice(meter({ model: 'volume', tiers }))).toBeNull();
    });

    it('rejects invalid prices', () => {
      expect(validateMeteredPrice(meter({ metric: ' ' }))).toMatch(/metric is required/);
      expect(validateMeteredPrice(meter({ includedUnits: -1 }))).toMatch(/includedUnits/);
      expect(validateMeteredPrice(meter({ unitPrice: undefined }))).toMatch(/requires a non-negative unitPrice/);
      expect(validateMeteredPrice(meter({ model: 'package', packageSize: 0, packagePrice: 1 }))).toMatch(
        /packageSize/,
      );
      expect(validateMeteredPrice(meter({ model: 'graduated', tiers: [] }))).toMatch(/at least one tier/);
      expect(
        validateMeteredPrice(meter({ model: 'graduated', tiers: [{ upTo: 100, unitPrice: 0.1 }] })),
      ).toMatch(/must be open-ended/);
      expect(
        validateMeteredPrice(
          meter({
            model: 'volume',
            tiers: [
              { upTo: null, unitPrice: 0.1 },
              { upTo: null, unitPrice: 0.05 },
            ],
          }),
        ),
      ).toMatch(/only the last tier/);
      expect(
        validateMeteredPrice(
          meter({
            model: 'graduated',
            tiers: [
              { upTo: 500, unitPrice: 0.1 },
              { upTo: 100, unitPrice: 0.05 },
              { upTo: null, unitPrice: 0.01 },
            ],
          }),
        ),
      ).toMatch(/ascending/);
    });
  });
});
