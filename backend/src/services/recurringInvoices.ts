/**
 * Recurring invoice generation with FX-adjusted amounts.
 *
 * A template defines an amount in its own currency and a cadence. For every period that has
 * come due, the generator issues one invoice in the invoice currency, converted at the rate
 * for that issue date. The rate and its date are stored on the invoice, so the amount can be
 * audited later.
 *
 * Rules:
 *  - Idempotent: each period has the key `<templateId>:<issueDate>`. Running the generator
 *    again, including after a crash, cannot issue the same period twice. The store must
 *    enforce uniqueness on that key.
 *  - Fail closed on FX: if no usable rate is available, that period is not issued and is
 *    reported as failed. It is picked up by the next run. It is never issued at a guessed or
 *    zero rate.
 *  - Money is rounded once, at the end, to the currency's minor units.
 *
 * Dates are calendar dates (YYYY-MM-DD) interpreted in UTC.
 */

import { roundMoney } from './billing/money.js';

export type Cadence = 'weekly' | 'monthly';

export interface RecurringTemplate {
  id: string;
  customerId: string;
  description: string;
  /** Amount in `sourceCurrency`, in major units (e.g. 49.99 USD). */
  amount: number;
  sourceCurrency: string;
  invoiceCurrency: string;
  cadence: Cadence;
  /** First issue date, YYYY-MM-DD. */
  startDate: string;
  /** Last issue date allowed, YYYY-MM-DD. Omit for no end. */
  endDate?: string;
  /** Spread added to the converted amount, in basis points (100 = 1%). Must be >= 0. */
  fxSpreadBps?: number;
  active?: boolean;
}

/** Units of `quote` per one unit of `base`, on the given calendar date. */
export interface RateProvider {
  rate(base: string, quote: string, onDate: string): Promise<number>;
}

export interface GeneratedInvoice {
  key: string;
  templateId: string;
  customerId: string;
  description: string;
  issueDate: string;
  currency: string;
  amount: number;
  sourceCurrency: string;
  sourceAmount: number;
  rate: number;
  rateDate: string;
  fxSpreadBps: number;
}

export interface InvoiceStore {
  /** Returns true when inserted, false when the key already exists. Must be atomic. */
  insert(invoice: GeneratedInvoice): Promise<boolean>;
}

export interface RunReport {
  created: GeneratedInvoice[];
  duplicates: string[];
  failed: Array<{ key: string; reason: string }>;
}

export interface RecurringInvoiceOptions {
  store: InvoiceStore;
  rates: RateProvider;
  /** Cap on invoices produced in one run, so a long-dormant template cannot flood the store. */
  maxInvoicesPerRun?: number;
  now?: () => Date;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Currencies with no minor unit. Everything else uses two decimals. */
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW']);
const MAX_PERIODS_PER_TEMPLATE = 1200;

export function minorUnitDecimals(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

function parseIsoDate(value: string): Date | null {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function daysInMonthUtc(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * The `n`th period after `startDate`. Monthly periods keep the start day where possible and
 * clamp to the last day of shorter months (Jan 31 -> Feb 28/29 -> Mar 31).
 */
export function addPeriod(startDate: string, cadence: Cadence, n: number): string {
  const start = parseIsoDate(startDate);
  if (!start) throw new RangeError(`invalid date: ${startDate}`);
  if (cadence === 'weekly') {
    return new Date(start.getTime() + n * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  const year = start.getUTCFullYear();
  const monthIndex = start.getUTCMonth() + n;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const day = Math.min(start.getUTCDate(), daysInMonthUtc(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth, day)).toISOString().slice(0, 10);
}

/** Issue dates for a template that have come due on or before `asOf` (both inclusive). */
export function dueIssueDates(template: RecurringTemplate, asOf: string): string[] {
  const start = parseIsoDate(template.startDate);
  const asOfDate = parseIsoDate(asOf);
  if (!start || !asOfDate) return [];
  const end = template.endDate ? parseIsoDate(template.endDate) : null;
  const limit = end && end < asOfDate ? end : asOfDate;
  const dates: string[] = [];
  for (let n = 0; n < MAX_PERIODS_PER_TEMPLATE; n += 1) {
    const date = addPeriod(template.startDate, template.cadence, n);
    if (parseIsoDate(date)!.getTime() > limit.getTime()) break;
    dates.push(date);
  }
  return dates;
}

/**
 * Converts `sourceAmount` at `rate`, adds the spread, and rounds to the invoice currency.
 * Throws when the inputs cannot produce a meaningful amount.
 */
export function fxAdjustedAmount(
  sourceAmount: number,
  rate: number,
  spreadBps: number,
  invoiceCurrency: string,
): number {
  if (!Number.isFinite(sourceAmount) || sourceAmount <= 0) {
    throw new RangeError('sourceAmount must be a positive number');
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError('rate must be a positive number');
  }
  if (!Number.isFinite(spreadBps) || spreadBps < 0) {
    throw new RangeError('fxSpreadBps must be zero or positive');
  }
  const converted = sourceAmount * rate * (1 + spreadBps / 10_000);
  return roundMoney(converted, minorUnitDecimals(invoiceCurrency));
}

function validateTemplate(template: RecurringTemplate): string | null {
  if (!template.id || !template.customerId) return 'missing id or customerId';
  if (!(template.amount > 0)) return 'amount must be positive';
  if (!/^[A-Z]{3}$/.test(template.sourceCurrency) || !/^[A-Z]{3}$/.test(template.invoiceCurrency)) {
    return 'currencies must be ISO 4217 codes';
  }
  if (template.cadence !== 'weekly' && template.cadence !== 'monthly') return 'unknown cadence';
  if (!parseIsoDate(template.startDate)) return 'startDate must be YYYY-MM-DD';
  if (template.endDate !== undefined && !parseIsoDate(template.endDate)) return 'endDate must be YYYY-MM-DD';
  if (template.fxSpreadBps !== undefined && !(template.fxSpreadBps >= 0)) return 'fxSpreadBps must be zero or positive';
  return null;
}

export class RecurringInvoiceGenerator {
  private readonly store: InvoiceStore;
  private readonly rates: RateProvider;
  private readonly maxInvoicesPerRun: number;
  private readonly now: () => Date;

  constructor(options: RecurringInvoiceOptions) {
    this.store = options.store;
    this.rates = options.rates;
    this.maxInvoicesPerRun = options.maxInvoicesPerRun ?? 500;
    this.now = options.now ?? (() => new Date());
  }

  /** Issues every due period of every active template, as of `asOf` (default: today, UTC). */
  async run(templates: RecurringTemplate[], asOf?: string): Promise<RunReport> {
    const today = asOf ?? this.now().toISOString().slice(0, 10);
    const report: RunReport = { created: [], duplicates: [], failed: [] };
    let issued = 0;

    for (const template of templates) {
      if (template.active === false) continue;
      const invalid = validateTemplate(template);
      if (invalid) {
        report.failed.push({ key: `${template.id}:*`, reason: `invalid_template: ${invalid}` });
        continue;
      }
      for (const issueDate of dueIssueDates(template, today)) {
        if (issued >= this.maxInvoicesPerRun) return report;
        const key = `${template.id}:${issueDate}`;
        const outcome = await this.issueOne(template, issueDate, key);
        if (outcome.kind === 'created') {
          report.created.push(outcome.invoice);
          issued += 1;
        } else if (outcome.kind === 'duplicate') {
          report.duplicates.push(key);
        } else {
          report.failed.push({ key, reason: outcome.reason });
        }
      }
    }
    return report;
  }

  private async issueOne(
    template: RecurringTemplate,
    issueDate: string,
    key: string,
  ): Promise<
    | { kind: 'created'; invoice: GeneratedInvoice }
    | { kind: 'duplicate' }
    | { kind: 'failed'; reason: string }
  > {
    let rate: number;
    try {
      rate = await this.rates.rate(template.sourceCurrency, template.invoiceCurrency, issueDate);
    } catch {
      return { kind: 'failed', reason: 'fx_rate_unavailable' };
    }
    const spread = template.fxSpreadBps ?? 0;
    let amount: number;
    try {
      amount = fxAdjustedAmount(template.amount, rate, spread, template.invoiceCurrency);
    } catch {
      return { kind: 'failed', reason: 'fx_rate_invalid' };
    }

    const invoice: GeneratedInvoice = {
      key,
      templateId: template.id,
      customerId: template.customerId,
      description: template.description,
      issueDate,
      currency: template.invoiceCurrency,
      amount,
      sourceCurrency: template.sourceCurrency,
      sourceAmount: template.amount,
      rate,
      rateDate: issueDate,
      fxSpreadBps: spread,
    };
    const inserted = await this.store.insert(invoice);
    return inserted ? { kind: 'created', invoice } : { kind: 'duplicate' };
  }
}
