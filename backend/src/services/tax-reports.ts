// Tax report generation for merchant compliance — Issue #351
//
// Generates the documents merchants need at filing time from their
// transaction history: a tax-year summary (gross/net volume), a US 1099-K
// form, configurable VAT reports, multi-jurisdiction economic-nexus
// detection, and regulatory CSV export. Records carry a retention policy so
// generated documents can be archived for the required period.
//
// Monetary aggregation assumes a single reporting currency. Where a merchant
// transacts in multiple currencies, pass `rates` to convert into the reporting
// currency; unconverted currencies are surfaced via `warnings` and a
// per-currency breakdown so nothing is silently mis-summed.

export type TaxTransactionType = 'sale' | 'refund';

export interface TaxableTransaction {
  id: string;
  merchantId: string;
  /** Positive gross amount in `currency` for both sales and refunds. */
  amount: number;
  currency: string;
  /** ISO 3166-1 alpha-2 jurisdiction code, e.g. 'US', 'GB', 'DE'. */
  jurisdiction: string;
  type: TaxTransactionType;
  timestamp: Date;
}

export interface CurrencyBreakdown {
  currency: string;
  gross: number;
  refunds: number;
  net: number;
  count: number;
}

export interface JurisdictionBreakdown {
  jurisdiction: string;
  gross: number;
  refunds: number;
  net: number;
  count: number;
}

export interface SummaryOptions {
  /** Currency the aggregate totals are reported in. Default 'USD'. */
  reportingCurrency?: string;
  /** Multipliers from a given currency into the reporting currency. */
  rates?: Record<string, number>;
}

export interface TaxYearSummary {
  merchantId: string;
  year: number;
  reportingCurrency: string;
  grossVolume: number;
  refundVolume: number;
  netVolume: number;
  /** Sale transactions counted toward volume (excludes refunds). */
  saleCount: number;
  totalTransactionCount: number;
  byCurrency: CurrencyBreakdown[];
  byJurisdiction: JurisdictionBreakdown[];
  warnings: string[];
  retention: RetentionPolicy;
  generatedAt: string;
}

export interface Form1099KThreshold {
  grossAmount: number;
  /** When omitted, only the gross-amount threshold applies. */
  transactionCount?: number;
}

export interface Form1099K {
  formType: '1099-K';
  merchantId: string;
  year: number;
  currency: string;
  grossAmount: number;
  cardNotPresentCount: number;
  /** Gross per calendar month, index 0 = January. */
  monthlyGross: number[];
  threshold: Form1099KThreshold;
  reportingRequired: boolean;
  retention: RetentionPolicy;
  generatedAt: string;
}

export interface VatReportOptions {
  jurisdiction: string;
  /** Rate as a fraction, e.g. 0.2 for 20%. */
  rate: number;
  /** Treat recorded amounts as VAT-inclusive (extract VAT) rather than net. */
  amountsIncludeVat?: boolean;
}

export interface VatReport {
  reportType: 'VAT';
  merchantId: string;
  year: number;
  jurisdiction: string;
  rate: number;
  taxableBase: number;
  vatDue: number;
  transactionCount: number;
  currency: string;
  retention: RetentionPolicy;
  generatedAt: string;
}

export interface NexusThresholds {
  amount?: number;
  transactions?: number;
}

export interface NexusResult {
  jurisdiction: string;
  grossAmount: number;
  transactionCount: number;
  hasNexus: boolean;
}

export interface RetentionPolicy {
  retentionYears: number;
  /** ISO timestamp until which the document must be retained. */
  retainUntil: string;
}

const DEFAULT_1099K_THRESHOLD: Form1099KThreshold = {
  grossAmount: 20_000,
  transactionCount: 200,
};

const DEFAULT_NEXUS_THRESHOLDS: Required<NexusThresholds> = {
  amount: 100_000,
  transactions: 200,
};

const RETENTION_YEARS = 7;

export class TaxReportService {
  private transactions: TaxableTransaction[] = [];

  recordTransaction(tx: TaxableTransaction): void {
    this.transactions.push({ ...tx, currency: tx.currency.toUpperCase() });
  }

  recordMany(txs: TaxableTransaction[]): void {
    txs.forEach((tx) => this.recordTransaction(tx));
  }

  /** Tax-year summary with gross/net volume and per-currency/jurisdiction breakdowns. */
  getYearSummary(merchantId: string, year: number, options: SummaryOptions = {}): TaxYearSummary {
    const reportingCurrency = (options.reportingCurrency ?? 'USD').toUpperCase();
    const rates = options.rates ?? {};
    const warnings: string[] = [];
    const txs = this.forMerchantYear(merchantId, year);

    const convert = (amount: number, currency: string): number => {
      if (currency === reportingCurrency) return amount;
      const rate = rates[currency];
      if (rate === undefined) {
        const message = `No exchange rate for ${currency}->${reportingCurrency}; left unconverted`;
        if (!warnings.includes(message)) warnings.push(message);
        return amount;
      }
      return amount * rate;
    };

    const currencyMap = new Map<string, CurrencyBreakdown>();
    const jurisdictionMap = new Map<string, JurisdictionBreakdown>();
    let grossVolume = 0;
    let refundVolume = 0;
    let saleCount = 0;

    for (const tx of txs) {
      const converted = convert(tx.amount, tx.currency);

      const cur = currencyMap.get(tx.currency) ?? {
        currency: tx.currency,
        gross: 0,
        refunds: 0,
        net: 0,
        count: 0,
      };
      const jur = jurisdictionMap.get(tx.jurisdiction) ?? {
        jurisdiction: tx.jurisdiction,
        gross: 0,
        refunds: 0,
        net: 0,
        count: 0,
      };
      cur.count += 1;
      jur.count += 1;

      if (tx.type === 'sale') {
        grossVolume += converted;
        saleCount += 1;
        cur.gross += tx.amount;
        jur.gross += converted;
      } else {
        refundVolume += converted;
        cur.refunds += tx.amount;
        jur.refunds += converted;
      }
      cur.net = cur.gross - cur.refunds;
      jur.net = jur.gross - jur.refunds;
      currencyMap.set(tx.currency, cur);
      jurisdictionMap.set(tx.jurisdiction, jur);
    }

    return {
      merchantId,
      year,
      reportingCurrency,
      grossVolume: round2(grossVolume),
      refundVolume: round2(refundVolume),
      netVolume: round2(grossVolume - refundVolume),
      saleCount,
      totalTransactionCount: txs.length,
      byCurrency: [...currencyMap.values()].map(round2Breakdown),
      byJurisdiction: [...jurisdictionMap.values()].map(round2Breakdown),
      warnings,
      retention: this.getRetentionPolicy(year),
      generatedAt: new Date().toISOString(),
    };
  }

  /** US 1099-K form. Reports gross sales (not net of refunds) per IRS rules. */
  generate1099K(
    merchantId: string,
    year: number,
    threshold: Form1099KThreshold = DEFAULT_1099K_THRESHOLD,
  ): Form1099K {
    const sales = this.forMerchantYear(merchantId, year).filter(
      (tx) => tx.type === 'sale' && tx.jurisdiction === 'US',
    );

    const monthlyGross = new Array<number>(12).fill(0);
    let grossAmount = 0;
    for (const tx of sales) {
      monthlyGross[tx.timestamp.getUTCMonth()] += tx.amount;
      grossAmount += tx.amount;
    }

    const meetsGross = grossAmount >= threshold.grossAmount;
    const meetsCount =
      threshold.transactionCount === undefined || sales.length >= threshold.transactionCount;

    return {
      formType: '1099-K',
      merchantId,
      year,
      currency: 'USD',
      grossAmount: round2(grossAmount),
      cardNotPresentCount: sales.length,
      monthlyGross: monthlyGross.map(round2),
      threshold,
      reportingRequired: meetsGross && meetsCount,
      retention: this.getRetentionPolicy(year),
      generatedAt: new Date().toISOString(),
    };
  }

  /** VAT report for a single jurisdiction at a configurable rate. */
  generateVatReport(merchantId: string, year: number, options: VatReportOptions): VatReport {
    if (options.rate < 0 || options.rate > 1) {
      throw new Error('VAT rate must be a fraction between 0 and 1');
    }

    const txs = this.forMerchantYear(merchantId, year).filter(
      (tx) => tx.jurisdiction === options.jurisdiction,
    );
    const currency = txs[0]?.currency ?? 'USD';

    let net = 0;
    for (const tx of txs) {
      net += tx.type === 'sale' ? tx.amount : -tx.amount;
    }

    // When recorded amounts already include VAT, back it out of the base.
    const taxableBase = options.amountsIncludeVat ? net / (1 + options.rate) : net;
    const vatDue = taxableBase * options.rate;

    return {
      reportType: 'VAT',
      merchantId,
      year,
      jurisdiction: options.jurisdiction,
      rate: options.rate,
      taxableBase: round2(taxableBase),
      vatDue: round2(vatDue),
      transactionCount: txs.length,
      currency,
      retention: this.getRetentionPolicy(year),
      generatedAt: new Date().toISOString(),
    };
  }

  /** Economic-nexus detection per jurisdiction against amount/transaction thresholds. */
  detectNexus(
    merchantId: string,
    year: number,
    thresholds: NexusThresholds = {},
  ): NexusResult[] {
    const amountThreshold = thresholds.amount ?? DEFAULT_NEXUS_THRESHOLDS.amount;
    const txThreshold = thresholds.transactions ?? DEFAULT_NEXUS_THRESHOLDS.transactions;

    const byJurisdiction = new Map<string, { gross: number; count: number }>();
    for (const tx of this.forMerchantYear(merchantId, year)) {
      if (tx.type !== 'sale') continue;
      const agg = byJurisdiction.get(tx.jurisdiction) ?? { gross: 0, count: 0 };
      agg.gross += tx.amount;
      agg.count += 1;
      byJurisdiction.set(tx.jurisdiction, agg);
    }

    return [...byJurisdiction.entries()]
      .map(([jurisdiction, agg]) => ({
        jurisdiction,
        grossAmount: round2(agg.gross),
        transactionCount: agg.count,
        hasNexus: agg.gross >= amountThreshold || agg.count >= txThreshold,
      }))
      .sort((a, b) => b.grossAmount - a.grossAmount);
  }

  getRetentionPolicy(year: number): RetentionPolicy {
    return {
      retentionYears: RETENTION_YEARS,
      retainUntil: new Date(Date.UTC(year + RETENTION_YEARS, 11, 31, 23, 59, 59)).toISOString(),
    };
  }

  /** Regulatory CSV export of a tax-year summary. */
  summaryToCsv(summary: TaxYearSummary): string {
    const rows: string[][] = [
      ['Field', 'Value'],
      ['Merchant', summary.merchantId],
      ['Tax Year', String(summary.year)],
      ['Reporting Currency', summary.reportingCurrency],
      ['Gross Volume', summary.grossVolume.toFixed(2)],
      ['Refund Volume', summary.refundVolume.toFixed(2)],
      ['Net Volume', summary.netVolume.toFixed(2)],
      ['Sale Count', String(summary.saleCount)],
      ['Total Transactions', String(summary.totalTransactionCount)],
      [],
      ['Jurisdiction', 'Gross', 'Refunds', 'Net', 'Count'],
      ...summary.byJurisdiction.map((j) => [
        j.jurisdiction,
        j.gross.toFixed(2),
        j.refunds.toFixed(2),
        j.net.toFixed(2),
        String(j.count),
      ]),
    ];
    return toCsv(rows);
  }

  /** Regulatory CSV export of a 1099-K form. */
  form1099KToCsv(form: Form1099K): string {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    const rows: string[][] = [
      ['Form', form.formType],
      ['Merchant', form.merchantId],
      ['Tax Year', String(form.year)],
      ['Currency', form.currency],
      ['Gross Amount', form.grossAmount.toFixed(2)],
      ['Transaction Count', String(form.cardNotPresentCount)],
      ['Reporting Required', form.reportingRequired ? 'YES' : 'NO'],
      [],
      ['Month', 'Gross'],
      ...form.monthlyGross.map((g, i) => [months[i], g.toFixed(2)]),
    ];
    return toCsv(rows);
  }

  resetForTests(): void {
    this.transactions = [];
  }

  private forMerchantYear(merchantId: string, year: number): TaxableTransaction[] {
    return this.transactions.filter(
      (tx) => tx.merchantId === merchantId && tx.timestamp.getUTCFullYear() === year,
    );
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round2Breakdown<T extends { gross: number; refunds: number; net: number }>(b: T): T {
  return { ...b, gross: round2(b.gross), refunds: round2(b.refunds), net: round2(b.net) };
}

function toCsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => escapeCsv(cell)).join(','))
    .join('\n');
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export const taxReportService = new TaxReportService();
