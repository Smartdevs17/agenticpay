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

// ── Revenue Forecasting ──────────────────────────────────────────────────────

export interface ForecastPoint {
  timestamp: string;
  actual: number | null;
  forecast: number;
  lowerBound: number;
  upperBound: number;
}

export interface RevenueForecast {
  historical: ForecastPoint[];
  forecast: ForecastPoint[];
  summary: {
    next7Days: number;
    next30Days: number;
    next90Days: number;
    confidence: 'low' | 'medium' | 'high';
    trend: 'up' | 'down' | 'stable';
  };
}

// ── Cohort Analysis ──────────────────────────────────────────────────────────

export interface CohortDefinition {
  cohortId: string;
  cohortDate: string;
  periodLabel: string;
  users: number;
  retention: Record<string, number>;
  revenue: Record<string, number>;
}

export interface CohortAnalysisResult {
  cohorts: CohortDefinition[];
  overallRetention: Record<string, number>;
  periodLabels: string[];
  summary: {
    totalCohorts: number;
    firstWeekRetention: number;
    firstMonthRetention: number;
    bestCohort: string;
    worstCohort: string;
  };
}

// ── Forecasting helpers ──────────────────────────────────────────────────────

function linearRegression(data: Array<{ x: number; y: number }>): { slope: number; intercept: number; r2: number } {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  const sumX = data.reduce((s, d) => s + d.x, 0);
  const sumY = data.reduce((s, d) => s + d.y, 0);
  const sumXY = data.reduce((s, d) => s + d.x * d.y, 0);
  const sumX2 = data.reduce((s, d) => s + d.x * d.x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const ssRes = data.reduce((s, d) => s + (d.y - (slope * d.x + intercept)) ** 2, 0);
  const ssTot = data.reduce((s, d) => s + (d.y - sumY / n) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

function movingAverage(data: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = data.slice(start, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return result;
}

function seasonalAdjustment(data: number[], period: number): number[] {
  if (data.length < period * 2) return data.map(() => 1);
  const factors: number[] = [];
  for (let i = 0; i < period; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i; j < data.length; j += period) {
      sum += data[j];
      count++;
    }
    const avg = sum / count;
    const overallAvg = data.reduce((a, b) => a + b, 0) / data.length;
    factors.push(overallAvg > 0 ? avg / overallAvg : 1);
  }
  return factors;
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

  // ── Revenue Forecasting ──────────────────────────────────────────────────

  buildRevenueForecast(since?: Date): RevenueForecast {
    const data = this.filterSince(since).filter((p) => p.status === 'completed');
    if (data.length < 2) {
      return {
        historical: [],
        forecast: [],
        summary: { next7Days: 0, next30Days: 0, next90Days: 0, confidence: 'low', trend: 'stable' },
      };
    }

    const dailyBuckets = new Map<string, number>();
    const earliest = new Date(
      data.reduce((min, p) => Math.min(min, p.timestamp.getTime()), Date.now())
    );
    const latest = new Date(Date.now());

    for (const p of data) {
      const key = this.bucketKey(p.timestamp, 'day');
      dailyBuckets.set(key, (dailyBuckets.get(key) ?? 0) + p.amount);
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const daysCount = Math.ceil((latest.getTime() - earliest.getTime()) / dayMs) + 1;
    const points: Array<{ x: number; y: number; timestamp: string }> = [];

    for (let i = 0; i < daysCount; i++) {
      const d = new Date(earliest.getTime() + i * dayMs);
      const key = this.bucketKey(d, 'day');
      const revenue = dailyBuckets.get(key) ?? 0;
      if (revenue > 0 || i >= daysCount - 14) {
        points.push({ x: i, y: revenue, timestamp: key });
      }
    }

    if (points.length < 2) {
      return {
        historical: [],
        forecast: [],
        summary: { next7Days: 0, next30Days: 0, next90Days: 0, confidence: 'low', trend: 'stable' },
      };
    }

    const recentPoints = points.slice(-30);
    const regression = linearRegression(recentPoints.map((p) => ({ x: p.x, y: p.y })));
    const ma7 = movingAverage(points.map((p) => p.y), 7);
    const seasonal = seasonalAdjustment(points.map((p) => p.y), 7);

    const historical: ForecastPoint[] = points.map((p, i) => ({
      timestamp: p.timestamp,
      actual: p.y,
      forecast: ma7[i] ?? p.y,
      lowerBound: Math.max(0, (ma7[i] ?? p.y) * 0.8),
      upperBound: (ma7[i] ?? p.y) * 1.2,
    }));

    const lastX = points[points.length - 1].x;
    const lastY = ma7[ma7.length - 1] ?? points[points.length - 1].y;
    const lastSeasonal = seasonal[seasonal.length - 1] ?? 1;
    const forecastDays = 90;

    const forecast: ForecastPoint[] = [];
    for (let i = 1; i <= forecastDays; i++) {
      const x = lastX + i;
      const trendVal = regression.slope * x + regression.intercept;
      const seasonalFactor = seasonal[(points.length - 1 + i) % seasonal.length] ?? lastSeasonal;
      const forecastVal = Math.max(0, trendVal * seasonalFactor * 0.7 + lastY * 0.3);
      const residualStd = recentPoints.length > 2
        ? Math.sqrt(recentPoints.reduce((s, p) => s + (p.y - (regression.slope * p.x + regression.intercept)) ** 2, 0) / (recentPoints.length - 2))
        : forecastVal * 0.3;
      const d = new Date(latest.getTime() + i * dayMs);
      forecast.push({
        timestamp: this.bucketKey(d, 'day'),
        actual: null,
        forecast: Math.round(forecastVal * 100) / 100,
        lowerBound: Math.max(0, Math.round((forecastVal - 1.96 * residualStd) * 100) / 100),
        upperBound: Math.round((forecastVal + 1.96 * residualStd) * 100) / 100,
      });
    }

    const next7Days = forecast.slice(0, 7).reduce((s, f) => s + f.forecast, 0);
    const next30Days = forecast.slice(0, 30).reduce((s, f) => s + f.forecast, 0);
    const next90Days = forecast.reduce((s, f) => s + f.forecast, 0);

    const trend = regression.slope > 0.5 ? 'up' : regression.slope < -0.5 ? 'down' : 'stable';
    const confidence = regression.r2 > 0.7 ? 'high' : regression.r2 > 0.3 ? 'medium' : 'low';

    return {
      historical,
      forecast,
      summary: {
        next7Days: Math.round(next7Days * 100) / 100,
        next30Days: Math.round(next30Days * 100) / 100,
        next90Days: Math.round(next90Days * 100) / 100,
        confidence,
        trend,
      },
    };
  }

  // ── Cohort Analysis ──────────────────────────────────────────────────────

  buildCohortAnalysis(since?: Date): CohortAnalysisResult {
    const data = this.filterSince(since);
    if (data.length === 0) {
      return {
        cohorts: [],
        overallRetention: {},
        periodLabels: [],
        summary: {
          totalCohorts: 0,
          firstWeekRetention: 0,
          firstMonthRetention: 0,
          bestCohort: '',
          worstCohort: '',
        },
      };
    }

    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const earliest = new Date(
      data.reduce((min, p) => Math.min(min, p.timestamp.getTime()), Date.now())
    );
    const latest = new Date(Date.now());
    const cohortWeeks = Math.max(1, Math.ceil((latest.getTime() - earliest.getTime()) / weekMs));
    const periodLabels = Array.from({ length: cohortWeeks }, (_, i) => `Week ${i + 1}`);

    const cohorts = new Map<string, Map<string, { users: Set<string>; revenue: number }>>();

    for (const p of data) {
      const cohortKey = this.bucketByWeek(p.timestamp, earliest);
      const periodKey = this.bucketByWeekOffset(p.timestamp, earliest);
      if (!cohorts.has(cohortKey)) {
        cohorts.set(cohortKey, new Map());
      }
      const cohort = cohorts.get(cohortKey)!;
      if (!cohort.has(periodKey)) {
        cohort.set(periodKey, { users: new Set(), revenue: 0 });
      }
      const entry = cohort.get(periodKey)!;
      entry.users.add(p.id);
      entry.revenue += p.amount;
    }

    const cohortDefs: CohortDefinition[] = [];
    let totalFirstWeekRetention = 0;
    let totalFirstMonthRetention = 0;
    let retentionCount = 0;

    for (const [cohortKey, periods] of cohorts) {
      const sortedPeriods = Array.from(periods.entries()).sort(([a], [b]) => a.localeCompare(b));
      const firstPeriod = sortedPeriods[0];
      if (!firstPeriod) continue;
      const totalUsers = firstPeriod[1].users.size;
      if (totalUsers === 0) continue;

      const retention: Record<string, number> = {};
      const revenue: Record<string, number> = {};

      for (const [periodKey, data] of sortedPeriods) {
        const periodIdx = periodLabels.findIndex((_, i) => {
          const start = new Date(earliest.getTime() + i * weekMs);
          return this.bucketByWeek(start, earliest) === periodKey;
        });
        if (periodIdx >= 0) {
          retention[periodLabels[periodIdx]] = totalUsers > 0 ? Math.round((data.users.size / totalUsers) * 10000) / 100 : 0;
          revenue[periodLabels[periodIdx]] = Math.round(data.revenue * 100) / 100;
        }
      }

      const allPeriodKeys = sortedPeriods.map(([k]) => k);
      const week1Retention = allPeriodKeys.length > 1 && sortedPeriods[1]
        ? (sortedPeriods[1][1].users.size / totalUsers) * 100
        : 0;
      const week4Retention = allPeriodKeys.length > 4 && sortedPeriods[4]
        ? (sortedPeriods[4][1].users.size / totalUsers) * 100
        : 0;

      totalFirstWeekRetention += week1Retention;
      totalFirstMonthRetention += week4Retention;
      retentionCount++;

      cohortDefs.push({
        cohortId: cohortKey,
        cohortDate: cohortKey,
        periodLabel: `Cohort ${cohortKey}`,
        users: totalUsers,
        retention,
        revenue,
      });
    }

    cohortDefs.sort((a, b) => a.cohortDate.localeCompare(b.cohortDate));

    const overallRetention: Record<string, number> = {};
    const maxPeriods = Math.max(...cohortDefs.map((c) => Object.keys(c.retention).length));
    for (let i = 0; i < Math.min(maxPeriods, periodLabels.length); i++) {
      let sum = 0;
      let count = 0;
      for (const c of cohortDefs) {
        if (c.retention[periodLabels[i]] !== undefined) {
          sum += c.retention[periodLabels[i]];
          count++;
        }
      }
      overallRetention[periodLabels[i]] = count > 0 ? Math.round((sum / count) * 100) / 100 : 0;
    }

    const sortedByRetention = [...cohortDefs].sort(
      (a, b) => (b.retention[periodLabels[0]] ?? 0) - (a.retention[periodLabels[0]] ?? 0)
    );

    return {
      cohorts: cohortDefs,
      overallRetention,
      periodLabels,
      summary: {
        totalCohorts: cohortDefs.length,
        firstWeekRetention: retentionCount > 0 ? Math.round((totalFirstWeekRetention / retentionCount) * 100) / 100 : 0,
        firstMonthRetention: retentionCount > 0 ? Math.round((totalFirstMonthRetention / retentionCount) * 100) / 100 : 0,
        bestCohort: sortedByRetention[0]?.cohortId ?? '',
        worstCohort: sortedByRetention[sortedByRetention.length - 1]?.cohortId ?? '',
      },
    };
  }

  private bucketByWeek(date: Date, epoch: Date): string {
    const diffMs = date.getTime() - epoch.getTime();
    const week = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
    const d = new Date(epoch.getTime() + week * 7 * 24 * 60 * 60 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  private bucketByWeekOffset(date: Date, epoch: Date): string {
    const diffMs = date.getTime() - epoch.getTime();
    const week = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
    return `w${week}`;
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
