// Customer Lifetime Value dashboard service â€” Issue #943
export interface CLVPayment {
  id: string; customerId: string; amount: number; currency: string;
  status: 'completed' | 'pending' | 'failed' | 'refunded'; timestamp: Date;
  metadata?: Record<string, unknown>;
}
export interface CustomerCLV {
  customerId: string; totalSpend: number; orderCount: number; averageOrderValue: number;
  firstPurchase: string | null; lastPurchase: string | null; lifespanMonths: number;
  purchaseFrequencyPerMonth: number; clv: number; tier: 'bronze' | 'silver' | 'gold' | 'platinum';
}
export interface CLVDashboard {
  asOf: string; totalCustomers: number; totalSpend: number; averageCLV: number;
  medianCLV: number; topCustomers: CustomerCLV[];
  distribution: Record<'bronze' | 'silver' | 'gold' | 'platinum', number>;
}
const LIFESPAN_CAP_MONTHS = 36; const MIN_LIFESPAN_MONTHS = 1 / 12;
function tierFor(clv: number): CustomerCLV['tier'] {
  if (clv >= 10000) return 'platinum'; if (clv >= 5000) return 'gold';
  if (clv >= 1000) return 'silver'; return 'bronze';
}
export class CLVService {
  private readonly payments: CLVPayment[] = [];
  recordPayment(entry: Omit<CLVPayment, 'id' | 'timestamp'> & { timestamp?: Date }): CLVPayment {
    const payment: CLVPayment = { id: crypto.randomUUID(), customerId: entry.customerId, amount: entry.amount,
      currency: entry.currency, status: entry.status, timestamp: entry.timestamp ?? new Date(), metadata: entry.metadata };
    this.payments.push(payment); return payment;
  }
  list(): CLVPayment[] { return [...this.payments]; }
  private customerPayments(customerId: string): CLVPayment[] {
    return this.payments.filter((p) => p.customerId === customerId && p.status === 'completed')
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
  getCLV(customerId: string, asOf?: Date): CustomerCLV {
    const now = asOf ?? new Date(); const payments = this.customerPayments(customerId);
    const totalSpend = payments.reduce((s, p) => s + p.amount, 0); const orderCount = payments.length;
    if (orderCount === 0) {
      return { customerId, totalSpend: 0, orderCount: 0, averageOrderValue: 0, firstPurchase: null,
        lastPurchase: null, lifespanMonths: 0, purchaseFrequencyPerMonth: 0, clv: 0, tier: 'bronze' };
    }
    const averageOrderValue = totalSpend / orderCount;
    const firstPurchase = payments[payments.length - 1].timestamp;
    const lastPurchase = payments[0].timestamp;
    const lifespanMonths = Math.max(MIN_LIFESPAN_MONTHS, (now.getTime() - firstPurchase.getTime()) / (1000 * 60 * 60 * 24 * 30));
    const cappedLifespan = Math.min(lifespanMonths, LIFESPAN_CAP_MONTHS);
    const purchaseFrequencyPerMonth = orderCount / cappedLifespan;
    const clv = averageOrderValue * purchaseFrequencyPerMonth * cappedLifespan;
    return { customerId, totalSpend, orderCount, averageOrderValue, firstPurchase: firstPurchase.toISOString(),
      lastPurchase: lastPurchase.toISOString(), lifespanMonths: cappedLifespan, purchaseFrequencyPerMonth, clv, tier: tierFor(clv) };
  }
  dashboard(opts?: { asOf?: Date; limit?: number }): CLVDashboard {
    const now = opts?.asOf ?? new Date();
    const customerIds = [...new Set(this.payments.map((p) => p.customerId))];
    const customers = customerIds.map((id) => this.getCLV(id, now)).sort((a, b) => b.clv - a.clv);
    const totalCustomers = customers.length;
    const totalSpend = customers.reduce((s, c) => s + c.totalSpend, 0);
    const clvs = customers.map((c) => c.clv);
    const averageCLV = totalCustomers === 0 ? 0 : clvs.reduce((s, v) => s + v, 0) / totalCustomers;
    const medianCLV = median(clvs);
    const limit = opts?.limit ?? 20; const topCustomers = customers.slice(0, limit);
    const distribution = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
    for (const c of customers) distribution[c.tier] += 1;
    return { asOf: now.toISOString(), totalCustomers, totalSpend, averageCLV, medianCLV, topCustomers, distribution };
  }
}
function median(values: number[]): number {
  if (values.length === 0) return 0; const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
export const clvService = new CLVService();
