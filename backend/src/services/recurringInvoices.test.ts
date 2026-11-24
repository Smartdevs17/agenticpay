import { describe, expect, it, vi } from 'vitest';
import {
  addPeriod,
  dueIssueDates,
  fxAdjustedAmount,
  GeneratedInvoice,
  InvoiceStore,
  RateProvider,
  RecurringInvoiceGenerator,
  RecurringTemplate,
} from './recurringInvoices.js';

const TEMPLATE: RecurringTemplate = {
  id: 'tpl-1',
  customerId: 'cust-9',
  description: 'Hosting',
  amount: 49.99,
  sourceCurrency: 'USD',
  invoiceCurrency: 'EUR',
  cadence: 'monthly',
  startDate: '2026-01-15',
  fxSpreadBps: 150,
};

/** Store that enforces key uniqueness, the way a unique index would. */
function memoryStore(): InvoiceStore & { invoices: GeneratedInvoice[] } {
  const invoices: GeneratedInvoice[] = [];
  const keys = new Set<string>();
  return {
    invoices,
    async insert(invoice) {
      if (keys.has(invoice.key)) return false;
      keys.add(invoice.key);
      invoices.push(invoice);
      return true;
    },
  };
}

function fixedRates(rate = 0.92): RateProvider & { rate: ReturnType<typeof vi.fn> } {
  return { rate: vi.fn(async () => rate) } as RateProvider & { rate: ReturnType<typeof vi.fn> };
}

describe('addPeriod', () => {
  it('adds monthly periods and clamps to the end of a shorter month', () => {
    expect(addPeriod('2027-01-31', 'monthly', 1)).toBe('2027-02-28');
    expect(addPeriod('2027-01-31', 'monthly', 2)).toBe('2027-03-31');
  });

  it('handles leap years', () => {
    expect(addPeriod('2028-01-31', 'monthly', 1)).toBe('2028-02-29');
  });

  it('rolls over the year', () => {
    expect(addPeriod('2026-11-15', 'monthly', 2)).toBe('2027-01-15');
  });

  it('adds weekly periods of seven days', () => {
    expect(addPeriod('2026-01-01', 'weekly', 2)).toBe('2026-01-15');
  });

  it('rejects a malformed start date', () => {
    expect(() => addPeriod('2026-02-30', 'monthly', 1)).toThrow(RangeError);
  });
});

describe('dueIssueDates', () => {
  it('lists every period up to and including asOf', () => {
    expect(dueIssueDates(TEMPLATE, '2026-03-15')).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
  });

  it('stops at the end date', () => {
    expect(dueIssueDates({ ...TEMPLATE, endDate: '2026-02-20' }, '2026-06-01')).toEqual([
      '2026-01-15',
      '2026-02-15',
    ]);
  });

  it('returns nothing before the first period', () => {
    expect(dueIssueDates(TEMPLATE, '2026-01-14')).toEqual([]);
  });
});

describe('fxAdjustedAmount', () => {
  it('converts, adds the spread and rounds to minor units', () => {
    // 49.99 * 0.92 = 45.9908; * 1.015 = 46.67 after rounding.
    expect(fxAdjustedAmount(49.99, 0.92, 150, 'EUR')).toBe(46.67);
  });

  it('uses zero decimals for zero-decimal currencies', () => {
    expect(fxAdjustedAmount(10, 150.5, 0, 'JPY')).toBe(1505);
  });

  it('refuses a zero or non-finite rate instead of producing an amount', () => {
    expect(() => fxAdjustedAmount(10, 0, 0, 'EUR')).toThrow(RangeError);
    expect(() => fxAdjustedAmount(10, Number.NaN, 0, 'EUR')).toThrow(RangeError);
  });

  it('refuses a negative spread', () => {
    expect(() => fxAdjustedAmount(10, 1, -1, 'EUR')).toThrow(RangeError);
  });
});

describe('RecurringInvoiceGenerator.run', () => {
  it('issues one invoice per due period, with the rate and its date recorded', async () => {
    const store = memoryStore();
    const rates = fixedRates();
    const generator = new RecurringInvoiceGenerator({ store, rates });

    const report = await generator.run([TEMPLATE], '2026-02-20');

    expect(report.created.map((i) => i.issueDate)).toEqual(['2026-01-15', '2026-02-15']);
    expect(report.created[0]).toMatchObject({
      key: 'tpl-1:2026-01-15',
      currency: 'EUR',
      sourceCurrency: 'USD',
      sourceAmount: 49.99,
      rate: 0.92,
      rateDate: '2026-01-15',
      fxSpreadBps: 150,
      amount: 46.67,
    });
    expect(rates.rate).toHaveBeenCalledWith('USD', 'EUR', '2026-01-15');
  });

  it('does not issue the same period twice when run again', async () => {
    const store = memoryStore();
    const generator = new RecurringInvoiceGenerator({ store, rates: fixedRates() });

    await generator.run([TEMPLATE], '2026-02-20');
    const second = await generator.run([TEMPLATE], '2026-02-20');

    expect(second.created).toEqual([]);
    expect(second.duplicates).toEqual(['tpl-1:2026-01-15', 'tpl-1:2026-02-15']);
    expect(store.invoices).toHaveLength(2);
  });

  it('leaves a period un-issued when the FX rate is unavailable, and issues it on a later run', async () => {
    const store = memoryStore();
    const rates = {
      rate: vi.fn().mockRejectedValueOnce(new Error('feed down')).mockResolvedValue(0.92),
    } as unknown as RateProvider;
    const generator = new RecurringInvoiceGenerator({ store, rates });

    const first = await generator.run([TEMPLATE], '2026-01-15');
    expect(first.created).toEqual([]);
    expect(first.failed).toEqual([{ key: 'tpl-1:2026-01-15', reason: 'fx_rate_unavailable' }]);
    expect(store.invoices).toEqual([]);

    const second = await generator.run([TEMPLATE], '2026-01-15');
    expect(second.created.map((i) => i.key)).toEqual(['tpl-1:2026-01-15']);
  });

  it('never issues at a zero or NaN rate', async () => {
    const store = memoryStore();
    const generator = new RecurringInvoiceGenerator({ store, rates: fixedRates(0) });

    const report = await generator.run([TEMPLATE], '2026-01-15');

    expect(report.created).toEqual([]);
    expect(report.failed[0].reason).toBe('fx_rate_invalid');
    expect(store.invoices).toEqual([]);
  });

  it('skips inactive templates', async () => {
    const store = memoryStore();
    const generator = new RecurringInvoiceGenerator({ store, rates: fixedRates() });

    const report = await generator.run([{ ...TEMPLATE, active: false }], '2026-02-20');

    expect(report).toEqual({ created: [], duplicates: [], failed: [] });
  });

  it('reports an invalid template without throwing or affecting other templates', async () => {
    const store = memoryStore();
    const generator = new RecurringInvoiceGenerator({ store, rates: fixedRates() });
    const bad = { ...TEMPLATE, id: 'bad', amount: -1 };

    const report = await generator.run([bad, { ...TEMPLATE, id: 'good' }], '2026-01-15');

    expect(report.failed).toEqual([{ key: 'bad:*', reason: 'invalid_template: amount must be positive' }]);
    expect(report.created.map((i) => i.templateId)).toEqual(['good']);
  });

  it('stops at maxInvoicesPerRun', async () => {
    const store = memoryStore();
    const generator = new RecurringInvoiceGenerator({ store, rates: fixedRates(), maxInvoicesPerRun: 2 });

    const report = await generator.run([{ ...TEMPLATE, cadence: 'weekly', startDate: '2026-01-01' }], '2026-03-01');

    expect(report.created).toHaveLength(2);
    expect(store.invoices).toHaveLength(2);
  });
});
