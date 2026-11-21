import { describe, expect, it } from 'vitest';
import {
  InvalidAmountError,
  compareMinor,
  formatMinor,
  fromMinorToNumber,
  isValidAmount,
  multiplyByRate,
  parseDecimalToMinor,
  quantizeNumber,
  sumAmounts,
} from '../money.js';

describe('money', () => {
  describe('parseDecimalToMinor', () => {
    it('parses whole and fractional values into minor units', () => {
      expect(parseDecimalToMinor('10', 2)).toBe(1000n);
      expect(parseDecimalToMinor('10.01', 2)).toBe(1001n);
      expect(parseDecimalToMinor('-0.1', 2)).toBe(-10n);
      expect(parseDecimalToMinor('0', 6)).toBe(0n);
    });

    it('avoids the binary floating point error that plain multiplication introduces', () => {
      // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754 doubles.
      expect(0.1 + 0.2).not.toBe(0.3);
      const total = parseDecimalToMinor('0.1', 2) + parseDecimalToMinor('0.2', 2);
      expect(formatMinor(total, 2)).toBe('0.30');
    });

    it('rounds half away from zero when the value has more precision than the currency', () => {
      expect(parseDecimalToMinor('10.005', 2)).toBe(1001n);
      expect(parseDecimalToMinor('10.004', 2)).toBe(1000n);
      expect(parseDecimalToMinor('-10.005', 2)).toBe(-1001n);
    });

    it('truncates precision below the currency scale instead of inventing it', () => {
      expect(parseDecimalToMinor('0.000001', 2)).toBe(0n);
      expect(parseDecimalToMinor('1e-7', 2)).toBe(0n);
    });

    it('supports scientific notation produced by String(number)', () => {
      expect(parseDecimalToMinor(String(1e-7), 7)).toBe(1n);
      expect(parseDecimalToMinor(String(1.5e21), 2)).toBe(150000000000000000000000n);
    });

    it('rejects values that are not decimal amounts', () => {
      for (const value of ['', 'abc', '1.2.3', 'USD', '--1', null, undefined, {}]) {
        expect(() => parseDecimalToMinor(value as string, 2)).toThrow(InvalidAmountError);
      }
    });

    it('rejects NaN and Infinity', () => {
      expect(() => parseDecimalToMinor(Number.NaN, 2)).toThrow(InvalidAmountError);
      expect(() => parseDecimalToMinor(Number.POSITIVE_INFINITY, 2)).toThrow(InvalidAmountError);
    });
  });

  describe('formatMinor', () => {
    it('renders fixed-point strings with the requested scale', () => {
      expect(formatMinor(1001n, 2)).toBe('10.01');
      expect(formatMinor(-1001n, 2)).toBe('-10.01');
      expect(formatMinor(5n, 6)).toBe('0.000005');
      expect(formatMinor(42n, 0)).toBe('42');
    });

    it('round-trips through parse without loss', () => {
      for (const value of ['0.00', '19.99', '1234567.89', '-0.01']) {
        expect(formatMinor(parseDecimalToMinor(value, 2), 2)).toBe(value);
      }
    });
  });

  describe('multiplyByRate', () => {
    it('applies a rate exactly, without float drift', () => {
      // 33.33 * 1.08 === 35.99640000000001 as a double.
      const crypto = multiplyByRate(parseDecimalToMinor('33.33', 2), 1.08, 7);
      expect(formatMinor(crypto, 7)).toBe('35.9964000');
    });

    it('matches the naive product wherever the naive product is already exact', () => {
      const crypto = multiplyByRate(parseDecimalToMinor('100', 2), 1.0, 6);
      expect(formatMinor(crypto, 6)).toBe('100.000000');
    });

    it('rounds half away from zero on the crypto side', () => {
      // 0.005 * 1 === 0.005, which cannot be represented in a 2-decimal scale.
      const crypto = multiplyByRate(parseDecimalToMinor('0.01', 2), 0.5, 2);
      expect(formatMinor(crypto, 2)).toBe('0.01');
    });

    it('is exact for a zero amount regardless of rate', () => {
      expect(multiplyByRate(0n, 1.26, 7)).toBe(0n);
    });

    it('rejects a non-finite or negative rate', () => {
      for (const rate of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
        expect(() => multiplyByRate(1000n, rate, 6)).toThrow(InvalidAmountError);
      }
    });
  });

  describe('helpers', () => {
    it('sums decimal strings without drift', () => {
      expect(sumAmounts(['0.10', '0.20'], 2)).toBe('0.30');
      expect(sumAmounts(['1.005', '2.005'], 2)).toBe('3.02');
      expect(sumAmounts([], 2)).toBe('0.00');
    });

    it('quantizes numbers to a fixed scale', () => {
      expect(quantizeNumber(1.005, 2)).toBe(1.01);
      expect(quantizeNumber(0.1 + 0.2, 2)).toBe(0.3);
      expect(quantizeNumber(600, 6)).toBe(600);
    });

    it('reports amount validity', () => {
      expect(isValidAmount(1)).toBe(true);
      expect(isValidAmount(0)).toBe(true);
      expect(isValidAmount(Number.NaN)).toBe(false);
      expect(isValidAmount(Number.POSITIVE_INFINITY)).toBe(false);
      expect(isValidAmount('1')).toBe(false);
    });

    it('compares and converts minor units', () => {
      expect(compareMinor(100n, 200n)).toBe(-1);
      expect(compareMinor(200n, 200n)).toBe(0);
      expect(compareMinor(300n, 200n)).toBe(1);
      expect(fromMinorToNumber(1001n, 2)).toBe(10.01);
    });
  });
});