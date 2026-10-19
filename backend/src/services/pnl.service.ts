// Multi-currency Profit & Loss reporting service â€” Issue #941
export interface FXRate { from: string; to: string; rate: number; }
export interface PLLine {
  currency: string; revenue: number; cost: number; profit: number; margin: number;
  revenueBase: number; costBase: number; profitBase: number;
}
export interface PLReport {
  baseCurrency: string; asOf: string; lines: PLLine[];
  totals: { revenue: number; cost: number; profit: number; margin: number; };
  fxRates: Record<string, number>;
}
export interface PLRecord {
  id: string; type: 'revenue' | 'cost'; amount: number; currency: string;
  timestamp: Date; reference?: string; metadata?: Record<string, unknown>;
}
type RateKey = `${string}|${string}`;

export class PnLService {
  private readonly ledger: PLRecord[] = [];
  private readonly fxRates = new Map<RateKey, number>();
  private readonly baseCurrency: string;
  constructor(baseCurrency = 'USD') { this.baseCurrency = baseCurrency.toUpperCase(); }
  record(entry: Omit<PLRecord, 'id' | 'timestamp'> & { timestamp?: Date }): PLRecord {
    const record: PLRecord = { id: crypto.randomUUID(), type: entry.type, amount: entry.amount,
      currency: entry.currency, timestamp: entry.timestamp ?? new Date(),
      reference: entry.reference, metadata: entry.metadata };
    this.ledger.push(record); return record;
  }
  recordRevenue(amount: number, currency: string, opts?: { reference?: string; metadata?: Record<string, unknown>; timestamp?: Date }): PLRecord {
    return this.record({ type: 'revenue', amount, currency: currency.toUpperCase(), ...opts });
  }
  recordCost(amount: number, currency: string, opts?: { reference?: string; metadata?: Record<string, unknown>; timestamp?: Date }): PLRecord {
    return this.record({ type: 'cost', amount, currency: currency.toUpperCase(), ...opts });
  }
  setFXRate(from: string, to: string, rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Invalid FX rate ${rate} for ${from}->${to}`);
    this.fxRates.set(`${from.toUpperCase()}|${to.toUpperCase()}`, rate);
  }
  convert(amount: number, fromCurrency: string, toCurrency: string): number {
    const from = fromCurrency.toUpperCase(); const to = toCurrency.toUpperCase();
    if (from === to) return amount;
    const rate = this.fxRates.get(`${from}|${to}`);
    if (!rate) throw new Error(`No FX rate configured for ${from}->${to}`);
    return amount * rate;
  }
  private rateToBase(currency: string): number {
    const cur = currency.toUpperCase(); if (cur === this.baseCurrency) return 1;
    const rate = this.fxRates.get(`${cur}|${this.baseCurrency}`);
    if (!rate) throw new Error(`No FX rate configured for ${cur}->${this.baseCurrency}`);
    return rate;
  }
  report(opts?: { since?: Date; until?: Date }): PLReport {
    const since = opts?.since; const until = opts?.until;
    const byCurrency = new Map<string, { revenue: number; cost: number }>();
    for (const entry of this.ledger) {
      if (since && entry.timestamp < since) continue;
      if (until && entry.timestamp >= until) continue;
      const cur = entry.currency.toUpperCase();
      const acc = byCurrency.get(cur) ?? { revenue: 0, cost: 0 };
      if (entry.type === 'revenue') acc.revenue += entry.amount; else acc.cost += entry.amount;
      byCurrency.set(cur, acc);
    }
    const lines: PLLine[] = []; let totalRevenue = 0; let totalCost = 0; let totalProfit = 0;
    for (const [currency, acc] of [...byCurrency.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const revenue = acc.revenue; const cost = acc.cost; const profit = revenue - cost;
      const margin = revenue === 0 ? 0 : profit / revenue; const rate = this.rateToBase(currency);
      lines.push({ currency, revenue, cost, profit, margin, revenueBase: revenue * rate, costBase: cost * rate, profitBase: profit * rate });
      totalRevenue += revenue * rate; totalCost += cost * rate; totalProfit += profit * rate;
    }
    const totalMargin = totalRevenue === 0 ? 0 : totalProfit / totalRevenue;
    return { baseCurrency: this.baseCurrency, asOf: new Date().toISOString(), lines,
      totals: { revenue: totalRevenue, cost: totalCost, profit: totalProfit, margin: totalMargin },
      fxRates: Object.fromEntries([...this.fxRates.entries()].map(([k, v]) => [k, v])) };
  }
  list(): PLRecord[] { return [...this.ledger]; }
  count(): number { return this.ledger.length; }
}
export const pnlService = new PnLService('USD');
