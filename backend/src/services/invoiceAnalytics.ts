import { InvoiceRecord } from './invoice.js';

export interface InvoiceAnalyticsSummary {
  totalInvoices: number;
  totalAmount: number;
  paidAmount: number;
  overdueAmount: number;
  draftAmount: number;
  averageValue: number;
  statusBreakdown: Record<string, number>;
  monthlyTrend: Array<{ month: string; count: number; amount: number }>;
  topMerchants: Array<{ merchantId: string; count: number; total: number }>;
}

export interface InvoiceAnalyticsResult {
  summary: InvoiceAnalyticsSummary;
  statusTrend: Array<{ date: string; status: string; count: number }>;
  agingBreakdown: Array<{ range: string; count: number; amount: number }>;
  generatedAt: string;
}

export class InvoiceAnalyticsService {
  private invoiceHistory: InvoiceRecord[] = [];

  resetForTests(): void {
    this.invoiceHistory = [];
  }

  trackInvoice(invoice: InvoiceRecord): void {
    const existing = this.invoiceHistory.findIndex((i) => i.id === invoice.id);
    if (existing >= 0) {
      this.invoiceHistory[existing] = invoice;
    } else {
      this.invoiceHistory.push(invoice);
    }
  }

  buildAnalytics(merchantId?: string): InvoiceAnalyticsResult {
    const filtered = merchantId
      ? this.invoiceHistory.filter((i) => i.merchantId === merchantId)
      : this.invoiceHistory;

    const totalInvoices = filtered.length;
    const totalAmount = filtered.reduce((s, i) => s + i.total, 0);
    const paidAmount = filtered.filter((i) => i.status === 'paid').reduce((s, i) => s + i.total, 0);
    const overdueAmount = filtered.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.total, 0);
    const draftAmount = filtered.filter((i) => i.status === 'draft').reduce((s, i) => s + i.total, 0);

    const statusBreakdown: Record<string, number> = {};
    for (const inv of filtered) {
      statusBreakdown[inv.status] = (statusBreakdown[inv.status] || 0) + 1;
    }

    const monthBuckets = new Map<string, { count: number; amount: number }>();
    for (const inv of filtered) {
      const month = inv.createdAt.slice(0, 7);
      const bucket = monthBuckets.get(month) ?? { count: 0, amount: 0 };
      bucket.count += 1;
      bucket.amount += inv.total;
      monthBuckets.set(month, bucket);
    }

    const monthlyTrend = Array.from(monthBuckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }));

    const merchantTotals = new Map<string, { count: number; total: number }>();
    for (const inv of filtered) {
      const m = merchantTotals.get(inv.merchantId) ?? { count: 0, total: 0 };
      m.count += 1;
      m.total += inv.total;
      merchantTotals.set(inv.merchantId, m);
    }

    const topMerchants = Array.from(merchantTotals.entries())
      .map(([merchantId, data]) => ({ merchantId, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const dailyStatus = new Map<string, Map<string, number>>();
    for (const inv of filtered) {
      const date = inv.updatedAt.slice(0, 10);
      if (!dailyStatus.has(date)) dailyStatus.set(date, new Map());
      const statusMap = dailyStatus.get(date)!;
      statusMap.set(inv.status, (statusMap.get(inv.status) || 0) + 1);
    }

    const statusTrend = Array.from(dailyStatus.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([date, statuses]) =>
        Array.from(statuses.entries()).map(([status, count]) => ({ date, status, count }))
      );

    const agingBreakdown = this.computeAging(filtered);

    return {
      summary: {
        totalInvoices,
        totalAmount: Math.round(totalAmount * 100) / 100,
        paidAmount: Math.round(paidAmount * 100) / 100,
        overdueAmount: Math.round(overdueAmount * 100) / 100,
        draftAmount: Math.round(draftAmount * 100) / 100,
        averageValue: totalInvoices > 0 ? Math.round((totalAmount / totalInvoices) * 100) / 100 : 0,
        statusBreakdown,
        monthlyTrend,
        topMerchants,
      },
      statusTrend,
      agingBreakdown,
      generatedAt: new Date().toISOString(),
    };
  }

  private computeAging(invoices: InvoiceRecord[]): Array<{ range: string; count: number; amount: number }> {
    const now = Date.now();
    const ranges = [
      { label: '0-30 days', min: 0, max: 30 },
      { label: '31-60 days', min: 31, max: 60 },
      { label: '61-90 days', min: 61, max: 90 },
      { label: '90+ days', min: 91, max: Infinity },
    ];

    return ranges.map((range) => {
      const matching = invoices.filter((inv) => {
        if (inv.status === 'paid' || inv.status === 'cancelled') return false;
        const due = inv.dueDate ? new Date(inv.dueDate).getTime() : new Date(inv.createdAt).getTime();
        const daysOverdue = Math.floor((now - due) / (1000 * 60 * 60 * 24));
        return daysOverdue >= range.min && daysOverdue <= range.max;
      });

      return {
        range: range.label,
        count: matching.length,
        amount: Math.round(matching.reduce((s, i) => s + i.total, 0) * 100) / 100,
      };
    });
  }
}

export const invoiceAnalyticsService = new InvoiceAnalyticsService();
