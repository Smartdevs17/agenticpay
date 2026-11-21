import { describe, expect, it } from 'vitest';
import { quoteProration, remainingFraction, segmentShares } from '../proration.js';

const DAY = 24 * 60 * 60 * 1000;
const start = new Date('2026-02-01T00:00:00.000Z').getTime();
const end = start + 30 * DAY;

describe('proration (#812)', () => {
  describe('remainingFraction', () => {
    it('returns the unused share of the period', () => {
      expect(remainingFraction(0, 100, 25)).toBe(0.75);
    });

    it('clamps changes outside the period', () => {
      expect(remainingFraction(0, 100, -10)).toBe(1);
      expect(remainingFraction(0, 100, 150)).toBe(0);
    });

    it('rejects an empty period', () => {
      expect(() => remainingFraction(100, 100, 100)).toThrow(RangeError);
    });
  });

  describe('quoteProration', () => {
    it('credits unused time and charges the new plan for an upgrade', () => {
      const quote = quoteProration({
        currentPrice: 30,
        newPrice: 60,
        periodStart: start,
        periodEnd: end,
        changeAt: start + 10 * DAY,
      });

      expect(quote.fractionRemaining).toBeCloseTo(2 / 3, 5);
      expect(quote.fractionElapsed).toBeCloseTo(1 / 3, 5);
      expect(quote.unusedCredit).toBe(20);
      expect(quote.remainingCharge).toBe(40);
      expect(quote.net).toBe(20);
    });

    it('produces a negative net for a downgrade', () => {
      const quote = quoteProration({
        currentPrice: 60,
        newPrice: 30,
        periodStart: start,
        periodEnd: end,
        changeAt: start + 15 * DAY,
      });
      expect(quote.net).toBe(-15);
    });

    it('produces no adjustment at the very end of the period', () => {
      const quote = quoteProration({ currentPrice: 30, newPrice: 60, periodStart: start, periodEnd: end, changeAt: end });
      expect(quote.net).toBe(0);
    });
  });

  describe('segmentShares', () => {
    const segments = [
      { planId: 'basic', startedAt: new Date(start).toISOString() },
      { planId: 'pro', startedAt: new Date(start + 10 * DAY).toISOString() },
    ];

    it('splits the period between consecutive plan segments', () => {
      const shares = segmentShares(segments, start, end);
      expect(shares.map((s) => s.planId)).toEqual(['basic', 'pro']);
      expect(shares[0].fraction).toBeCloseTo(1 / 3, 5);
      expect(shares[1].fraction).toBeCloseTo(2 / 3, 5);
    });

    it('stops at the requested cut-off', () => {
      const shares = segmentShares(segments, start, end, start + 15 * DAY);
      expect(shares[1].fraction).toBeCloseTo(1 / 6, 5);
      expect(shares[1].endedAt).toBe(new Date(start + 15 * DAY).toISOString());
    });

    it('drops segments that cover no time', () => {
      const shares = segmentShares(
        [
          { planId: 'basic', startedAt: new Date(start).toISOString() },
          { planId: 'pro', startedAt: new Date(start).toISOString() },
        ],
        start,
        end,
      );
      expect(shares).toHaveLength(1);
      expect(shares[0]).toMatchObject({ planId: 'pro', fraction: 1 });
    });
  });
});
