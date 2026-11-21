import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLATFORM_FEE_BPS,
  buildCsv,
  dayKey,
  escapeCsvCell,
  feeForAmount,
  monthKey,
  parseReportPeriod,
  platformFeeBps,
  roundMoney,
  toAmount,
  weekKey,
} from '../report-format.js';

describe('toAmount', () => {
  it('accepts numbers, numeric strings and decimal-like objects', () => {
    expect(toAmount(12.5)).toBe(12.5);
    expect(toAmount('12.5')).toBe(12.5);
    expect(toAmount({ toString: () => '12.5' })).toBe(12.5);
    expect(toAmount({ toNumber: () => 12.5 })).toBe(12.5);
  });

  it('falls back to zero for values that are not numbers', () => {
    expect(toAmount(undefined)).toBe(0);
    expect(toAmount(null)).toBe(0);
    expect(toAmount('not-a-number')).toBe(0);
    expect(toAmount(Number.NaN)).toBe(0);
  });
});

describe('roundMoney', () => {
  it('rounds to eight decimal places', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(1.123456789)).toBe(1.12345679);
  });

  it('never returns NaN', () => {
    expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('feeForAmount', () => {
  it('applies basis points to the amount', () => {
    expect(feeForAmount(100, 100)).toBe(1);
    expect(feeForAmount(250, 50)).toBe(1.25);
  });

  it('charges nothing when no rate is configured', () => {
    expect(feeForAmount(100, 0)).toBe(0);
  });
});

describe('platformFeeBps', () => {
  it('defaults to no fee', () => {
    expect(platformFeeBps({} as NodeJS.ProcessEnv)).toBe(DEFAULT_PLATFORM_FEE_BPS);
  });

  it('reads a configured rate', () => {
    expect(platformFeeBps({ REPORT_PLATFORM_FEE_BPS: '250' } as NodeJS.ProcessEnv)).toBe(250);
  });

  it('rejects an invalid rate', () => {
    expect(() => platformFeeBps({ REPORT_PLATFORM_FEE_BPS: 'abc' } as NodeJS.ProcessEnv)).toThrow(
      /REPORT_PLATFORM_FEE_BPS/,
    );
    expect(() => platformFeeBps({ REPORT_PLATFORM_FEE_BPS: '-1' } as NodeJS.ProcessEnv)).toThrow(
      /REPORT_PLATFORM_FEE_BPS/,
    );
  });
});

describe('parseReportPeriod', () => {
  it('expands date-only strings to a full UTC day', () => {
    const period = parseReportPeriod('2026-01-01', '2026-01-31');

    expect(period.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(period.to.toISOString()).toBe('2026-01-31T23:59:59.999Z');
  });

  it('rejects a missing range', () => {
    expect(() => parseReportPeriod('', '2026-01-31')).toThrow(/dateFrom and dateTo are required/);
  });

  it('rejects an unparseable date', () => {
    expect(() => parseReportPeriod('yesterday', '2026-01-31')).toThrow(/valid ISO dates/);
  });

  it('rejects a reversed range', () => {
    expect(() => parseReportPeriod('2026-02-01', '2026-01-31')).toThrow(/must not be after/);
  });
});

describe('period keys', () => {
  it('derives day, month and ISO week keys in UTC', () => {
    const date = new Date('2026-01-31T12:00:00.000Z');

    expect(dayKey(date)).toBe('2026-01-31');
    expect(monthKey(date)).toBe('2026-01');
    expect(weekKey(date)).toBe('2026-01-26');
  });
});

describe('escapeCsvCell', () => {
  it('quotes separators, quotes and newlines', () => {
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(escapeCsvCell(null)).toBe('');
  });
});

describe('buildCsv', () => {
  it('joins blocks with a blank line between them', () => {
    const csv = buildCsv([
      { header: ['A', 'B'], rows: [[1, 2]] },
      { header: ['C'], rows: [['x,y']] },
    ]);

    expect(csv).toBe('A,B\n1,2\n\nC\n"x,y"');
  });
});
