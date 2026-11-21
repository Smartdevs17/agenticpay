// Payment method usage analytics service â€” Issue #942
export interface PaymentMethodUsageEvent {
  id: string; method: string; amount: number; currency: string;
  status: 'success' | 'failure' | 'pending'; timestamp: Date;
  metadata?: Record<string, unknown>;
}
export interface PaymentMethodStats {
  method: string; usageCount: number; successCount: number; failureCount: number; pendingCount: number;
  totalVolume: number; successVolume: number; successRate: number; averageTicket: number;
  averageSuccessTicket: number; lastUsed: string | null;
}
export interface PaymentMethodAnalytics {
  asOf: string; totalEvents: number; totalVolume: number; overallSuccessRate: number;
  byMethod: PaymentMethodStats[]; topMethod: PaymentMethodStats | null;
}
export class PaymentMethodAnalyticsService {
  private readonly events: PaymentMethodUsageEvent[] = [];
  recordUsage(entry: Omit<PaymentMethodUsageEvent, 'id' | 'timestamp'> & { timestamp?: Date }): PaymentMethodUsageEvent {
    const event: PaymentMethodUsageEvent = { id: crypto.randomUUID(), timestamp: entry.timestamp ?? new Date(),
      method: entry.method.toLowerCase(), ...entry };
    this.events.push(event); return event;
  }
  list(): PaymentMethodUsageEvent[] { return [...this.events]; }
  private methodEvents(method: string): PaymentMethodUsageEvent[] {
    const m = method.toLowerCase(); return this.events.filter((e) => e.method === m);
  }
  getMethodStats(method: string): PaymentMethodStats { return this.computeStats(this.methodEvents(method)); }
  getAnalytics(opts?: { since?: Date }): PaymentMethodAnalytics {
    const since = opts?.since; const events = since ? this.events.filter((e) => e.timestamp >= since) : this.events;
    const byMethodMap = new Map<string, PaymentMethodUsageEvent[]>();
    for (const e of events) { const arr = byMethodMap.get(e.method) ?? []; arr.push(e); byMethodMap.set(e.method, arr); }
    const byMethod = [...byMethodMap.entries()].map(([method, evs]) => this.computeStats(evs))
      .sort((a, b) => b.usageCount - a.usageCount || b.totalVolume - a.totalVolume);
    const totalVolume = events.reduce((s, e) => s + e.amount, 0);
    const overallSuccessRate = events.length === 0 ? 0 : events.filter((e) => e.status === 'success').length / events.length;
    return { asOf: new Date().toISOString(), totalEvents: events.length, totalVolume, overallSuccessRate, byMethod,
      topMethod: byMethod.length > 0 ? byMethod[0] : null };
  }
  private computeStats(evs: PaymentMethodUsageEvent[]): PaymentMethodStats {
    const usageCount = evs.length; const successCount = evs.filter((e) => e.status === 'success').length;
    const failureCount = evs.filter((e) => e.status === 'failure').length; const pendingCount = evs.filter((e) => e.status === 'pending').length;
    const totalVolume = evs.reduce((s, e) => s + e.amount, 0); const successVolume = evs.filter((e) => e.status === 'success').reduce((s, e) => s + e.amount, 0);
    const successRate = usageCount === 0 ? 0 : successCount / usageCount;
    const averageTicket = usageCount === 0 ? 0 : totalVolume / usageCount;
    const averageSuccessTicket = successCount === 0 ? 0 : successVolume / successCount;
    const lastUsed = usageCount === 0 ? null : evs[0].timestamp.toISOString();
    return { method: evs.length > 0 ? evs[0].method : '', usageCount, successCount, failureCount, pendingCount,
      totalVolume, successVolume, successRate, averageTicket, averageSuccessTicket, lastUsed };
  }
}
export const paymentMethodAnalyticsService = new PaymentMethodAnalyticsService();
