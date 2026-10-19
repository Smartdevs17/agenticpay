// Cash flow forecasting service â€” Issue #944
export interface CashFlow { id: string; type: 'inflow' | 'outflow'; amount: number; currency: string; timestamp: Date; reference?: string; metadata?: Record<string, unknown>; }
export interface ForecastPoint { period: number; timestamp: string; projectedInflow: number; projectedOutflow: number; projectedNetFlow: number; projectedBalance: number; }
export interface CashFlowForecast { asOf: string; startingBalance: number; currency: string; avgNetFlowPerPeriod: number; horizon: number; forecast: ForecastPoint[]; minBalance: number; minBalancePeriod: number | null; riskOfShortfall: boolean; }
export interface CashFlowSummary { asOf: string; totalInflow: number; totalOutflow: number; netFlow: number; currentBalance: number; transactionCount: number; }
export class CashFlowService {
  private readonly flows: CashFlow[] = [];
  recordFlow(entry: Omit<CashFlow, 'id' | 'timestamp'> & { timestamp?: Date }): CashFlow {
    const flow: CashFlow = { id: crypto.randomUUID(), type: entry.type, amount: entry.amount, currency: entry.currency,
      timestamp: entry.timestamp ?? new Date(), reference: entry.reference, metadata: entry.metadata };
    this.flows.push(flow); return flow;
  }
  recordInflow(amount: number, opts?: { currency?: string; reference?: string; metadata?: Record<string, unknown>; timestamp?: Date }) {
    return this.recordFlow({ type: 'inflow', amount, currency: (opts?.currency ?? 'USD'), reference: opts?.reference, metadata: opts?.metadata, timestamp: opts?.timestamp });
  }
  recordOutflow(amount: number, opts?: { currency?: string; reference?: string; metadata?: Record<string, unknown>; timestamp?: Date }) {
    return this.recordFlow({ type: 'outflow', amount, currency: (opts?.currency ?? 'USD'), reference: opts?.reference, metadata: opts?.metadata, timestamp: opts?.timestamp });
  }
  list(): CashFlow[] { return [...this.flows]; }
  summary(opts?: { since?: Date; until?: Date; currency?: string }): CashFlowSummary {
    const since = opts?.since; const until = opts?.until; const currency = (opts?.currency ?? 'USD').toUpperCase();
    const flows = this.flows.filter((f) => { if (f.currency.toUpperCase() !== currency) return false; if (since && f.timestamp < since) return false; if (until && f.timestamp >= until) return false; return true; });
    const totalInflow = flows.filter((f) => f.type === 'inflow').reduce((s, f) => s + f.amount, 0);
    const totalOutflow = flows.filter((f) => f.type === 'outflow').reduce((s, f) => s + f.amount, 0);
    return { asOf: new Date().toISOString(), totalInflow, totalOutflow, netFlow: totalInflow - totalOutflow, currentBalance: totalInflow - totalOutflow, transactionCount: flows.length };
  }
  forecast(opts?: { horizon?: number; asOf?: Date; currency?: string }): CashFlowForecast {
    const horizon = Math.max(1, Math.min(opts?.horizon ?? 12, 60)); const now = opts?.asOf ?? new Date(); const currency = (opts?.currency ?? 'USD').toUpperCase();
    const summary = this.summary({ until: now, currency }); const startingBalance = summary.currentBalance;
    let avgNetFlowPerPeriod = 0;
    if (summary.transactionCount > 0) {
      const periodMs = 30 * 24 * 60 * 60 * 1000; const oldest = now.getTime() - horizon * periodMs;
      const recent = this.flows.filter((f) => f.currency.toUpperCase() === currency && f.timestamp >= new Date(oldest) && f.timestamp <= now);
      const recentInflow = recent.filter((f) => f.type === 'inflow').reduce((s, f) => s + f.amount, 0);
      const recentOutflow = recent.filter((f) => f.type === 'outflow').reduce((s, f) => s + f.amount, 0);
      avgNetFlowPerPeriod = (recentInflow - recentOutflow) / Math.max(1, horizon);
    }
    const forecast: ForecastPoint[] = []; let balance = startingBalance; let minBalance = startingBalance; let minBalancePeriod: number | null = null;
    for (let period = 1; period <= horizon; period++) {
      const timestamp = new Date(now.getTime() + period * 30 * 24 * 60 * 60 * 1000);
      const projectedInflow = Math.max(0, avgNetFlowPerPeriod > 0 ? avgNetFlowPerPeriod : 0);
      const projectedOutflow = Math.max(0, -avgNetFlowPerPeriod); const projectedNetFlow = projectedInflow - projectedOutflow;
      balance += projectedNetFlow; if (balance < minBalance) { minBalance = balance; minBalancePeriod = period; }
      forecast.push({ period, timestamp: timestamp.toISOString(), projectedInflow, projectedOutflow, projectedNetFlow, projectedBalance: balance });
    }
    return { asOf: now.toISOString(), startingBalance, currency, avgNetFlowPerPeriod, horizon, forecast, minBalance, minBalancePeriod, riskOfShortfall: minBalance < 0 };
  }
}
export const cashFlowService = new CashFlowService();
