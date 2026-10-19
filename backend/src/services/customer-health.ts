// Customer Health Score System — Issue #855
// Composite health 0–100 based on payment, engagement, churn, support signals.

export type HealthActivityType =
  | 'payment_success'
  | 'payment_failed'
  | 'payment_refunded'
  | 'login'
  | 'api_call'
  | 'support_ticket_opened'
  | 'support_ticket_resolved'
  | 'subscription_cancelled'
  | 'subscription_renewed'
  | 'inactivity';

export interface HealthActivity {
  customerId: string;
  type: HealthActivityType;
  amount?: number;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface HealthFactor {
  name: string;
  score: number; // 0-100
  weight: number; // 0-1 sum 1
  details: string;
  value: number;
}

export interface HealthScore {
  customerId: string;
  score: number; // 0-100
  level: 'healthy' | 'at_risk' | 'critical' | 'champion';
  factors: HealthFactor[];
  trend: 'improving' | 'declining' | 'stable';
  previousScore?: number;
  lastCalculated: string;
  riskReasons: string[];
  recommendations: string[];
}

export interface HealthHistoryPoint {
  date: string;
  score: number;
  level: HealthScore['level'];
}

export interface HealthDistribution {
  healthy: number;
  at_risk: number;
  critical: number;
  champion: number;
  averageScore: number;
  totalCustomers: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HEALTH_WEIGHTS = {
  paymentHealth: 0.30,
  frequency: 0.20,
  recency: 0.20,
  engagement: 0.15,
  support: 0.15,
};

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export class CustomerHealthService {
  private activities: HealthActivity[] = [];
  private scoreHistory = new Map<string, HealthHistoryPoint[]>();
  private lastScores = new Map<string, number>();

  trackActivity(activity: Omit<HealthActivity, 'timestamp'> & { timestamp?: Date | string }): HealthActivity {
    if (!activity.customerId || typeof activity.customerId !== 'string') throw new Error('customerId required');
    if (!activity.type) throw new Error('type required');
    const ts =
      activity.timestamp instanceof Date
        ? activity.timestamp
        : typeof activity.timestamp === 'string'
          ? new Date(activity.timestamp)
          : new Date();
    if (Number.isNaN(ts.getTime())) throw new Error('Invalid timestamp');
    const record: HealthActivity = {
      customerId: activity.customerId,
      type: activity.type as HealthActivityType,
      amount: activity.amount,
      timestamp: ts,
      metadata: activity.metadata,
    };
    this.activities.push(record);
    // keep 180 days
    const cutoff = Date.now() - 180 * DAY_MS;
    this.activities = this.activities.filter((a) => a.timestamp.getTime() > cutoff);
    return record;
  }

  trackMany(activities: Array<Omit<HealthActivity, 'timestamp'> & { timestamp?: Date | string }>): void {
    for (const a of activities) this.trackActivity(a);
  }

  private getCustomerActivities(customerId: string, since?: Date): HealthActivity[] {
    let list = this.activities.filter((a) => a.customerId === customerId);
    if (since) list = list.filter((a) => a.timestamp >= since);
    return list.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  calculateScore(customerId: string, now = new Date()): HealthScore {
    const all = this.getCustomerActivities(customerId);
    const last90 = this.getCustomerActivities(customerId, new Date(now.getTime() - 90 * DAY_MS));
    const last30 = this.getCustomerActivities(customerId, new Date(now.getTime() - 30 * DAY_MS));
    const last7 = this.getCustomerActivities(customerId, new Date(now.getTime() - 7 * DAY_MS));

    // Factor 1: Payment health (success rate)
    const payments = last90.filter((a) => a.type === 'payment_success' || a.type === 'payment_failed');
    const success = payments.filter((a) => a.type === 'payment_success').length;
    const failed = payments.filter((a) => a.type === 'payment_failed').length;
    const paymentRate = payments.length ? success / payments.length : 1;
    let paymentScore = clamp(paymentRate * 100);
    // penalize repeated failures
    if (failed >= 3) paymentScore = clamp(paymentScore - 20);
    else if (failed >= 2) paymentScore = clamp(paymentScore - 10);
    const paymentDetails = payments.length ? `${success}/${payments.length} success (${(paymentRate * 100).toFixed(1)}%)` : 'No payments in 90d';

    // Factor 2: Frequency (payments / expected baseline)
    // baseline: assume 4 payments per 90d = healthy; scale
    const paymentFreq = last90.filter((a) => a.type === 'payment_success').length;
    // also count api_call as engagement but frequency is payment frequency
    let frequencyScore: number;
    if (paymentFreq === 0) frequencyScore = 20;
    else if (paymentFreq >= 8) frequencyScore = 95;
    else if (paymentFreq >= 4) frequencyScore = 80 + (paymentFreq - 4) * 3.75; // 80-95
    else frequencyScore = 20 + paymentFreq * 15; // 1->35, 2->50, 3->65

    // Factor 3: Recency (days since last success)
    const lastSuccess = [...all].reverse().find((a) => a.type === 'payment_success');
    let recencyScore: number;
    let daysSinceLastSuccess: number | null = null;
    if (!lastSuccess) {
      recencyScore = 15;
    } else {
      daysSinceLastSuccess = (now.getTime() - lastSuccess.timestamp.getTime()) / DAY_MS;
      if (daysSinceLastSuccess <= 7) recencyScore = 100;
      else if (daysSinceLastSuccess <= 14) recencyScore = 80;
      else if (daysSinceLastSuccess <= 30) recencyScore = 60;
      else if (daysSinceLastSuccess <= 60) recencyScore = 35;
      else recencyScore = 15;
    }

    // Factor 4: Engagement (logins + api_calls in last 30d)
    const engagementEvents = last30.filter((a) => a.type === 'login' || a.type === 'api_call').length;
    let engagementScore: number;
    if (engagementEvents >= 50) engagementScore = 100;
    else if (engagementEvents >= 20) engagementScore = 75 + (engagementEvents - 20) * 0.83;
    else if (engagementEvents >= 5) engagementScore = 40 + (engagementEvents - 5) * 2.33;
    else if (engagementEvents >= 1) engagementScore = 20 + engagementEvents * 4;
    else engagementScore = 10;
    // penalize inactivity marker
    const inactivityCount = last30.filter((a) => a.type === 'inactivity').length;
    if (inactivityCount > 0) engagementScore = clamp(engagementScore - inactivityCount * 10);

    // Factor 5: Support health
    const ticketsOpened = last90.filter((a) => a.type === 'support_ticket_opened').length;
    const ticketsResolved = last90.filter((a) => a.type === 'support_ticket_resolved').length;
    const cancelled = last90.filter((a) => a.type === 'subscription_cancelled').length;
    let supportScore = 100;
    if (ticketsOpened >= 5) supportScore -= 30;
    else if (ticketsOpened >= 3) supportScore -= 15;
    else if (ticketsOpened >= 1) supportScore -= 5;
    if (ticketsOpened > 0 && ticketsResolved < ticketsOpened) supportScore -= 10;
    if (cancelled > 0) supportScore -= 40;
    supportScore = clamp(supportScore);

    const factors: HealthFactor[] = [
      { name: 'payment_health', score: Math.round(paymentScore), weight: HEALTH_WEIGHTS.paymentHealth, details: paymentDetails, value: paymentRate },
      { name: 'frequency', score: Math.round(frequencyScore), weight: HEALTH_WEIGHTS.frequency, details: `${paymentFreq} successful payments in 90d`, value: paymentFreq },
      { name: 'recency', score: Math.round(recencyScore), weight: HEALTH_WEIGHTS.recency, details: daysSinceLastSuccess === null ? 'No previous success' : `${Math.floor(daysSinceLastSuccess)} days since last payment`, value: daysSinceLastSuccess ?? 999 },
      { name: 'engagement', score: Math.round(engagementScore), weight: HEALTH_WEIGHTS.engagement, details: `${engagementEvents} engagements in 30d`, value: engagementEvents },
      { name: 'support', score: Math.round(supportScore), weight: HEALTH_WEIGHTS.support, details: `${ticketsOpened} tickets opened, ${ticketsResolved} resolved, ${cancelled} cancellations`, value: ticketsOpened },
    ];

    const weightedScore = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
    // Extra penalty for churn signals
    let score = clamp(Math.round(weightedScore));
    // failed payment in last 7d extra penalty
    const failedLast7 = last7.filter((a) => a.type === 'payment_failed').length;
    if (failedLast7 >= 2) score = clamp(score - 15);
    if (cancelled > 0) score = clamp(score - 20);

    // Also consider refunds
    const refundsLast30 = last30.filter((a) => a.type === 'payment_refunded').length;
    if (refundsLast30 >= 2) score = clamp(score - 10);

    let level: HealthScore['level'];
    if (score >= 85) level = 'champion';
    else if (score >= 65) level = 'healthy';
    else if (score >= 40) level = 'at_risk';
    else level = 'critical';

    // Trend vs last score
    const prev = this.lastScores.get(customerId);
    let trend: HealthScore['trend'] = 'stable';
    if (prev !== undefined) {
      if (score > prev + 5) trend = 'improving';
      else if (score < prev - 5) trend = 'declining';
    }

    const riskReasons: string[] = [];
    if (paymentScore < 60) riskReasons.push('High payment failure rate');
    if (recencyScore < 40) riskReasons.push('No recent successful payment');
    if (frequencyScore < 40) riskReasons.push('Low payment frequency');
    if (engagementScore < 30) riskReasons.push('Low engagement');
    if (supportScore < 70) riskReasons.push('Support issues or cancellations');
    if (failedLast7 >= 2) riskReasons.push('Multiple failures in last 7 days');

    const recommendations: string[] = [];
    if (level === 'critical' || level === 'at_risk') {
      if (paymentScore < 60) recommendations.push('Offer payment retry assistance or alternative method');
      if (recencyScore < 40) recommendations.push('Send re-engagement campaign');
      if (engagementScore < 30) recommendations.push('Schedule check-in call');
      if (supportScore < 70) recommendations.push('Escalate to customer success manager');
      if (recommendations.length === 0) recommendations.push('Monitor closely and offer retention incentive');
    } else if (level === 'champion') {
      recommendations.push('Nurture advocacy and upsell opportunities');
    } else {
      recommendations.push('Maintain engagement with regular value touchpoints');
    }

    const result: HealthScore = {
      customerId,
      score,
      level,
      factors,
      trend,
      previousScore: prev,
      lastCalculated: now.toISOString(),
      riskReasons,
      recommendations,
    };

    // record history
    const hist = this.scoreHistory.get(customerId) ?? [];
    hist.push({ date: now.toISOString().slice(0, 10), score, level });
    if (hist.length > 180) hist.shift();
    this.scoreHistory.set(customerId, hist);
    this.lastScores.set(customerId, score);

    return result;
  }

  getHealth(customerId: string, now = new Date()): HealthScore {
    return this.calculateScore(customerId, now);
  }

  getHistory(customerId: string): HealthHistoryPoint[] {
    return this.scoreHistory.get(customerId) ?? [];
  }

  getTrend(customerId: string, days = 30): { direction: 'up' | 'down' | 'stable'; change: number; points: HealthHistoryPoint[] } {
    const hist = this.getHistory(customerId);
    if (hist.length < 2) return { direction: 'stable', change: 0, points: hist };
    const recent = hist.slice(-days);
    if (recent.length < 2) return { direction: 'stable', change: 0, points: recent };
    const first = recent[0].score;
    const last = recent[recent.length - 1].score;
    const change = last - first;
    let direction: 'up' | 'down' | 'stable' = 'stable';
    if (change > 5) direction = 'up';
    else if (change < -5) direction = 'down';
    return { direction, change, points: recent };
  }

  listAtRisk(threshold = 40, now = new Date()): HealthScore[] {
    const customers = new Set(this.activities.map((a) => a.customerId));
    const result: HealthScore[] = [];
    for (const cid of customers) {
      const score = this.calculateScore(cid, now);
      if (score.score <= threshold || score.level === 'at_risk' || score.level === 'critical') {
        result.push(score);
      }
    }
    return result.sort((a, b) => a.score - b.score);
  }

  getDistribution(now = new Date()): HealthDistribution {
    const customers = new Set(this.activities.map((a) => a.customerId));
    if (customers.size === 0) return { healthy: 0, at_risk: 0, critical: 0, champion: 0, averageScore: 0, totalCustomers: 0 };
    let healthy = 0;
    let at_risk = 0;
    let critical = 0;
    let champion = 0;
    let sum = 0;
    for (const cid of customers) {
      const h = this.calculateScore(cid, now);
      sum += h.score;
      if (h.level === 'healthy') healthy++;
      else if (h.level === 'at_risk') at_risk++;
      else if (h.level === 'critical') critical++;
      else if (h.level === 'champion') champion++;
    }
    return {
      healthy,
      at_risk,
      critical,
      champion,
      averageScore: Math.round((sum / customers.size) * 100) / 100,
      totalCustomers: customers.size,
    };
  }

  exportCsv(now = new Date()): string {
    const customers = new Set(this.activities.map((a) => a.customerId));
    const header = 'customerId,score,level,trend,riskReasons';
    const rows = Array.from(customers).map((cid) => {
      const h = this.calculateScore(cid, now);
      return `${cid},${h.score},${h.level},${h.trend},"${h.riskReasons.join('; ')}"`;
    });
    return [header, ...rows].join('\n');
  }

  resetForTests(): void {
    this.activities = [];
    this.scoreHistory.clear();
    this.lastScores.clear();
  }
}

export const customerHealthService = new CustomerHealthService();
