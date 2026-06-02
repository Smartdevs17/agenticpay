// Real-time payment analytics service — Issue #192
// Tracks payment funnel metrics, time-series revenue, and anomaly detection.

export interface FunnelStep {
  stage: 'initiated' | 'confirmed' | 'completed' | 'failed';
  count: number;
  amount: number;
  conversionRate: number;
}

export interface RevenuePoint {
  timestamp: string;
  revenue: number;
  count: number;
  network: string;
}

export interface AnomalyAlert {
  id: string;
  type: 'volume_spike' | 'drop_rate' | 'low_conversion';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  detectedAt: string;
}

export interface SegmentBreakdown {
  label: string;
  count: number;
  amount: number;
  percentage: number;
}

export interface AnalyticsSummary {
  totalRevenue: number;
  totalPayments: number;
  successRate: number;
  avgPaymentAmount: number;
  periodStart: string;
  periodEnd: string;
}

export interface AnalyticsSnapshot {
  funnel: FunnelStep[];
  revenue: RevenuePoint[];
  anomalies: AnomalyAlert[];
  byNetwork: SegmentBreakdown[];
  byCurrency: SegmentBreakdown[];
  summary: AnalyticsSummary;
  generatedAt: string;
}

export interface MerchantPercentile {
  volumePercentile: number;
  successRatePercentile: number;
  avgAmountPercentile: number;
  note: string;
}

export interface ReportSchedule {
  userId: string;
  email: string;
  frequencyHours: number;
  createdAt: string;
  lastSentAt?: string;
}

interface PaymentRecord {
  id: string;
  amount: number;
  currency: string;
  network: string;
  status: 'initiated' | 'confirmed' | 'completed' | 'failed';
  timestamp: Date;
}

// In-memory report schedule store
const reportSchedules = new Map<string, ReportSchedule>();

export function scheduleReport(userId: string, email: string, frequencyHours: number): ReportSchedule {
  const schedule: ReportSchedule = {
    userId,
    email,
    frequencyHours,
    createdAt: new Date().toISOString(),
  };
  reportSchedules.set(userId, schedule);
  return schedule;
}

export function getReportSchedule(userId: string): ReportSchedule | undefined {
  return reportSchedules.get(userId);
}

export function getAllReportSchedules(): ReportSchedule[] {
  return Array.from(reportSchedules.values());
}

export function markReportSent(userId: string): void {
  const schedule = reportSchedules.get(userId);
  if (schedule) {
    schedule.lastSentAt = new Date().toISOString();
  }
}

export class PaymentAnalyticsService {
  private payments: PaymentRecord[] = [];
  private readonly anomalyWindowMs = 60 * 60 * 1000; // 1 hour rolling window
  private readonly dropRateThreshold = 0.25; // alert if failure rate > 25%
  private readonly volumeSpikeMultiplier = 3; // alert if volume > 3x baseline

  trackPayment(payment: Omit<PaymentRecord, 'timestamp'> & { timestamp?: Date }): void {
    this.payments.push({
      ...payment,
      timestamp: payment.timestamp ?? new Date(),
    });

    // Keep only last 7 days of in-memory data
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.payments = this.payments.filter((p) => p.timestamp.getTime() > cutoff);
  }

  buildFunnel(since?: Date): FunnelStep[] {
    const data = this.filterSince(since);
    const counts = { initiated: 0, confirmed: 0, completed: 0, failed: 0 };
    const amounts = { initiated: 0, confirmed: 0, completed: 0, failed: 0 };

    for (const p of data) {
      counts[p.status] += 1;
      amounts[p.status] += p.amount;
    }

    const initiated = counts.initiated || (counts.confirmed + counts.completed + counts.failed) || 1;

    return [
      { stage: 'initiated', count: initiated, amount: amounts.initiated, conversionRate: 1 },
      { stage: 'confirmed', count: counts.confirmed, amount: amounts.confirmed, conversionRate: counts.confirmed / initiated },
      { stage: 'completed', count: counts.completed, amount: amounts.completed, conversionRate: counts.completed / initiated },
      { stage: 'failed', count: counts.failed, amount: amounts.failed, conversionRate: counts.failed / initiated },
    ];
  }

  buildTimeSeries(granularity: 'hour' | 'day' = 'hour', since?: Date): RevenuePoint[] {
    const data = this.filterSince(since).filter((p) => p.status === 'completed');
    const buckets = new Map<string, { revenue: number; count: number; network: string }>();

    for (const p of data) {
      const key = this.bucketKey(p.timestamp, granularity);
      const existing = buckets.get(key) ?? { revenue: 0, count: 0, network: p.network };
      existing.revenue += p.amount;
      existing.count += 1;
      buckets.set(key, existing);
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([timestamp, d]) => ({ timestamp, ...d }));
  }

  detectAnomalies(since?: Date): AnomalyAlert[] {
    const alerts: AnomalyAlert[] = [];
    const data = this.filterSince(since ?? new Date(Date.now() - this.anomalyWindowMs));

    if (data.length === 0) return alerts;

    // 1. Drop rate anomaly
    const failed = data.filter((p) => p.status === 'failed').length;
    const failureRate = failed / data.length;
    if (failureRate > this.dropRateThreshold) {
      alerts.push({
        id: `anomaly-drop-${Date.now()}`,
        type: 'drop_rate',
        severity: failureRate > 0.5 ? 'critical' : 'warning',
        message: `Failure rate ${(failureRate * 100).toFixed(1)}% exceeds threshold`,
        value: failureRate,
        threshold: this.dropRateThreshold,
        detectedAt: new Date().toISOString(),
      });
    }

    // 2. Volume spike — compare last 30 min to previous 30 min
    const now = Date.now();
    const recent = data.filter((p) => p.timestamp.getTime() > now - 30 * 60 * 1000).length;
    const previous = data.filter((p) => {
      const t = p.timestamp.getTime();
      return t > now - 60 * 60 * 1000 && t <= now - 30 * 60 * 1000;
    }).length;

    if (previous > 0 && recent > previous * this.volumeSpikeMultiplier) {
      alerts.push({
        id: `anomaly-spike-${Date.now()}`,
        type: 'volume_spike',
        severity: 'warning',
        message: `Payment volume spike: ${recent} in last 30min vs ${previous} baseline`,
        value: recent,
        threshold: previous * this.volumeSpikeMultiplier,
        detectedAt: new Date().toISOString(),
      });
    }

    // 3. Low conversion anomaly
    const completed = data.filter((p) => p.status === 'completed').length;
    const total = data.length;
    const conversionRate = total > 0 ? completed / total : 1;
    if (total >= 10 && conversionRate < 0.5) {
      alerts.push({
        id: `anomaly-conv-${Date.now()}`,
        type: 'low_conversion',
        severity: 'warning',
        message: `Low conversion rate: ${(conversionRate * 100).toFixed(1)}%`,
        value: conversionRate,
        threshold: 0.5,
        detectedAt: new Date().toISOString(),
      });
    }

    return alerts;
  }

  buildSegmentation(field: 'network' | 'currency', since?: Date): SegmentBreakdown[] {
    const data = this.filterSince(since);
    const groups = new Map<string, { count: number; amount: number }>();

    for (const p of data) {
      const key = p[field];
      const existing = groups.get(key) ?? { count: 0, amount: 0 };
      existing.count += 1;
      existing.amount += p.amount;
      groups.set(key, existing);
    }

    const total = data.length || 1;
    return Array.from(groups.entries())
      .map(([label, d]) => ({ label, ...d, percentage: d.count / total }))
      .sort((a, b) => b.count - a.count);
  }

  buildSummary(since?: Date): AnalyticsSummary {
    const data = this.filterSince(since);
    const completed = data.filter((p) => p.status === 'completed');
    const totalRevenue = completed.reduce((sum, p) => sum + p.amount, 0);

    return {
      totalRevenue,
      totalPayments: data.length,
      successRate: data.length > 0 ? completed.length / data.length : 0,
      avgPaymentAmount: completed.length > 0 ? totalRevenue / completed.length : 0,
      periodStart: (since ?? new Date(Date.now() - 24 * 60 * 60 * 1000)).toISOString(),
      periodEnd: new Date().toISOString(),
    };
  }

  snapshot(since?: Date): AnalyticsSnapshot {
    return {
      funnel: this.buildFunnel(since),
      revenue: this.buildTimeSeries('hour', since),
      anomalies: this.detectAnomalies(since),
      byNetwork: this.buildSegmentation('network', since),
      byCurrency: this.buildSegmentation('currency', since),
      summary: this.buildSummary(since),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Returns simulated industry percentile rankings for the merchant.
   * NOTE: Uses hardcoded benchmark curves — not real peer data.
   */
  buildMerchantPercentiles(since?: Date): MerchantPercentile {
    const summary = this.buildSummary(since);

    // Benchmark curves derived from simulated industry distributions
    const volumePercentile = this.scorePercentile(summary.totalRevenue, [500, 2000, 5000, 15000, 50000]);
    const successRatePercentile = this.scorePercentile(summary.successRate * 100, [60, 70, 78, 85, 95]);
    const avgAmountPercentile = this.scorePercentile(summary.avgPaymentAmount, [50, 150, 400, 1000, 3000]);

    return {
      volumePercentile,
      successRatePercentile,
      avgAmountPercentile,
      note: 'Estimated industry comparison — simulated benchmark data, not real peer metrics',
    };
  }

  private scorePercentile(value: number, thresholds: number[]): number {
    const brackets = [10, 25, 50, 75, 90, 99];
    for (let i = 0; i < thresholds.length; i++) {
      if (value < thresholds[i]) return brackets[i];
    }
    return brackets[thresholds.length];
  }

  exportToCsv(since?: Date): string {
    const revenue = this.buildTimeSeries('hour', since);
    const header = 'timestamp,revenue,count,network';
    const rows = revenue.map(
      (p) => `"${p.timestamp}",${p.revenue.toFixed(2)},${p.count},"${p.network}"`,
    );
    return [header, ...rows].join('\n');
  }

  private filterSince(since?: Date): PaymentRecord[] {
    if (!since) return this.payments;
    return this.payments.filter((p) => p.timestamp >= since);
  }

  private bucketKey(date: Date, granularity: 'hour' | 'day'): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    if (granularity === 'day') return `${y}-${m}-${d}`;
    const h = String(date.getUTCHours()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:00:00Z`;
  }
}

export const analyticsService = new PaymentAnalyticsService();

// Seed with representative data for demo
const now = Date.now();
const statuses: Array<'initiated' | 'confirmed' | 'completed' | 'failed'> = ['completed', 'completed', 'completed', 'confirmed', 'initiated', 'failed'];
const networks = ['stellar', 'stellar', 'stellar', 'ethereum'];
const currencies = ['XLM', 'XLM', 'USDC', 'ETH'];

for (let i = 0; i < 120; i++) {
  const hoursAgo = Math.random() * 48;
  analyticsService.trackPayment({
    id: `demo-${i}`,
    amount: 50 + Math.random() * 2000,
    currency: currencies[Math.floor(Math.random() * currencies.length)],
    network: networks[Math.floor(Math.random() * networks.length)],
    status: statuses[Math.floor(Math.random() * statuses.length)],
    timestamp: new Date(now - hoursAgo * 3600 * 1000),
  });
}
