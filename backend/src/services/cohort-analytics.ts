// Subscription cohort retention analytics — Issue #629
//
// In-memory, event-sourced cohort analytics for on-chain-managed subscriptions
// (there is no Prisma-persisted subscription/customer table in this codebase —
// see backend/src/jobs/subscription.service.ts). This service ingests subscription
// lifecycle events via `track()`/`trackMany()` (fed from SubscriptionProcessor,
// webhooks, or tests) and derives retention, revenue and churn cohorts from the
// full event history, matching the in-memory style of `services/analytics.ts`.
//
// See backend/docs/COHORT_ANALYTICS.md for the full data model, cohort-assignment
// rule, and exact formulas used below.

export type SubscriptionLifecycleEventType = 'started' | 'renewed' | 'cancelled' | 'payment_failed';

export interface SubscriptionLifecycleEvent {
  subscriptionId: string;
  customerId: string;
  event: SubscriptionLifecycleEventType;
  amount: number;
  currency: string;
  occurredAt: Date;
  planId?: string;
}

export interface CohortSummary {
  cohortMonth: string; // YYYY-MM
  cohortSize: number;
}

export interface RetentionPoint {
  monthOffset: number;
  activeCustomers: number;
  retentionPct: number;
}

export interface RevenueCohortPoint {
  monthOffset: number;
  totalRevenue: number;
  averageRevenuePerCustomer: number;
  activeCustomers: number;
}

export interface ChurnCohortPoint {
  monthOffset: number;
  churnedCustomers: number;
  churnRatePct: number;
  cumulativeChurnRatePct: number;
}

export interface CohortComparison {
  cohortMonths: string[];
  retention: Record<string, RetentionPoint[]>;
  revenue: Record<string, RevenueCohortPoint[]>;
  churn: Record<string, ChurnCohortPoint[]>;
  summary: {
    cohortSizes: Record<string, number>;
    bestRetentionCohort: { cohortMonth: string; monthOffset: number; retentionPct: number } | null;
    worstRetentionCohort: { cohortMonth: string; monthOffset: number; retentionPct: number } | null;
    averageRetentionPctByCohort: Record<string, number>;
  };
}

const LIFECYCLE_EVENTS: SubscriptionLifecycleEventType[] = ['started', 'renewed', 'cancelled', 'payment_failed'];

function monthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function parseMonthKey(key: string): { year: number; month: number } {
  const [y, m] = key.split('-').map((v) => parseInt(v, 10));
  return { year: y, month: m - 1 };
}

// Number of whole calendar months between `from` and `to` (both YYYY-MM keys).
function monthDiff(from: string, to: string): number {
  const a = parseMonthKey(from);
  const b = parseMonthKey(to);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

function addMonths(key: string, offset: number): string {
  const { year, month } = parseMonthKey(key);
  const total = year * 12 + month + offset;
  const y = Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

interface CustomerState {
  customerId: string;
  cohortMonth: string;
  events: SubscriptionLifecycleEvent[];
}

export class CohortAnalyticsService {
  private events: SubscriptionLifecycleEvent[] = [];

  track(event: SubscriptionLifecycleEvent): void {
    this.validateEvent(event);
    this.events.push({ ...event });
  }

  trackMany(events: SubscriptionLifecycleEvent[]): void {
    for (const event of events) {
      this.track(event);
    }
  }

  resetForTests(): void {
    this.events = [];
  }

  /**
   * Lists every cohort month present in the event history along with its size
   * (unique customers whose first `started` event falls in that month).
   */
  getCohorts(): CohortSummary[] {
    const customers = this.buildCustomerStates();
    const sizes = new Map<string, number>();
    for (const customer of customers.values()) {
      sizes.set(customer.cohortMonth, (sizes.get(customer.cohortMonth) ?? 0) + 1);
    }
    return Array.from(sizes.entries())
      .map(([cohortMonth, cohortSize]) => ({ cohortMonth, cohortSize }))
      .sort((a, b) => a.cohortMonth.localeCompare(b.cohortMonth));
  }

  /**
   * Retention curve for a cohort: for each month-offset N, the % of the cohort's
   * original customers still active in that offset month.
   * retentionPct = activeCustomers(offset) / cohortSize * 100
   */
  getRetentionCurve(cohortMonth: string): RetentionPoint[] {
    const cohortCustomers = this.customersInCohort(cohortMonth);
    const cohortSize = cohortCustomers.length;
    if (cohortSize === 0) return [];

    const maxOffset = this.maxOffsetForCohort(cohortMonth);
    const points: RetentionPoint[] = [];
    for (let offset = 0; offset <= maxOffset; offset++) {
      const activeCustomers = cohortCustomers.filter((c) => this.isActiveInOffsetMonth(c, cohortMonth, offset)).length;
      points.push({
        monthOffset: offset,
        activeCustomers,
        retentionPct: (activeCustomers / cohortSize) * 100,
      });
    }
    return points;
  }

  /**
   * Revenue per cohort by month-offset, from `started` + `renewed` event amounts.
   * averageRevenuePerCustomer = totalRevenue(offset) / activeCustomers(offset) (0 if no active customers)
   */
  getRevenueCohort(cohortMonth: string): RevenueCohortPoint[] {
    const cohortCustomers = this.customersInCohort(cohortMonth);
    if (cohortCustomers.length === 0) return [];

    const maxOffset = this.maxOffsetForCohort(cohortMonth);
    const points: RevenueCohortPoint[] = [];
    for (let offset = 0; offset <= maxOffset; offset++) {
      const targetMonth = addMonths(cohortMonth, offset);
      let totalRevenue = 0;
      const activeCustomerIds = new Set<string>();
      for (const customer of cohortCustomers) {
        for (const event of customer.events) {
          if (
            (event.event === 'started' || event.event === 'renewed') &&
            monthKey(event.occurredAt) === targetMonth
          ) {
            totalRevenue += event.amount;
            activeCustomerIds.add(customer.customerId);
          }
        }
      }
      points.push({
        monthOffset: offset,
        totalRevenue,
        averageRevenuePerCustomer: activeCustomerIds.size > 0 ? totalRevenue / activeCustomerIds.size : 0,
        activeCustomers: activeCustomerIds.size,
      });
    }
    return points;
  }

  /**
   * Churn per cohort by month-offset.
   * churnRatePct = churnedCustomers(offset) / activeAtStartOfOffset(offset) * 100
   *   where activeAtStartOfOffset(offset) = activeCustomers(offset - 1) for offset > 0,
   *   and cohortSize for offset 0 (nobody has had a chance to churn yet by definition,
   *   so churnedCustomers(0) is customers who cancelled within their signup month).
   * cumulativeChurnRatePct = distinct customers churned by end of this offset / cohortSize * 100
   */
  getChurnCohort(cohortMonth: string): ChurnCohortPoint[] {
    const cohortCustomers = this.customersInCohort(cohortMonth);
    const cohortSize = cohortCustomers.length;
    if (cohortSize === 0) return [];

    const maxOffset = this.maxOffsetForCohort(cohortMonth);
    const points: ChurnCohortPoint[] = [];
    const everChurned = new Set<string>();

    // activeAtOffset[offset] = count active at that offset, computed once via retention curve.
    const retention = this.getRetentionCurve(cohortMonth);
    const activeAtOffset = new Map<number, number>(retention.map((r) => [r.monthOffset, r.activeCustomers]));

    for (let offset = 0; offset <= maxOffset; offset++) {
      const targetMonth = addMonths(cohortMonth, offset);
      const churnedThisOffset = new Set<string>();
      for (const customer of cohortCustomers) {
        const churnedNow = customer.events.some(
          (e) => e.event === 'cancelled' && monthKey(e.occurredAt) === targetMonth,
        );
        if (churnedNow) {
          churnedThisOffset.add(customer.customerId);
          everChurned.add(customer.customerId);
        }
      }

      const activeAtStart = offset === 0 ? cohortSize : (activeAtOffset.get(offset - 1) ?? cohortSize);
      const churnRatePct = activeAtStart > 0 ? (churnedThisOffset.size / activeAtStart) * 100 : 0;

      points.push({
        monthOffset: offset,
        churnedCustomers: churnedThisOffset.size,
        churnRatePct,
        cumulativeChurnRatePct: (everChurned.size / cohortSize) * 100,
      });
    }
    return points;
  }

  /**
   * Side-by-side comparison of retention/revenue/churn curves for multiple cohorts,
   * plus best/worst retention (at each cohort's furthest common offset available)
   * and average retention per cohort.
   */
  compareCohorts(cohortMonths: string[]): CohortComparison {
    const retention: Record<string, RetentionPoint[]> = {};
    const revenue: Record<string, RevenueCohortPoint[]> = {};
    const churn: Record<string, ChurnCohortPoint[]> = {};
    const cohortSizes: Record<string, number> = {};
    const averageRetentionPctByCohort: Record<string, number> = {};

    let best: { cohortMonth: string; monthOffset: number; retentionPct: number } | null = null;
    let worst: { cohortMonth: string; monthOffset: number; retentionPct: number } | null = null;

    for (const cohortMonth of cohortMonths) {
      const curve = this.getRetentionCurve(cohortMonth);
      retention[cohortMonth] = curve;
      revenue[cohortMonth] = this.getRevenueCohort(cohortMonth);
      churn[cohortMonth] = this.getChurnCohort(cohortMonth);
      cohortSizes[cohortMonth] = this.customersInCohort(cohortMonth).length;

      if (curve.length > 0) {
        const avg = curve.reduce((sum, p) => sum + p.retentionPct, 0) / curve.length;
        averageRetentionPctByCohort[cohortMonth] = avg;

        for (const point of curve) {
          if (!best || point.retentionPct > best.retentionPct) {
            best = { cohortMonth, monthOffset: point.monthOffset, retentionPct: point.retentionPct };
          }
          if (!worst || point.retentionPct < worst.retentionPct) {
            worst = { cohortMonth, monthOffset: point.monthOffset, retentionPct: point.retentionPct };
          }
        }
      } else {
        averageRetentionPctByCohort[cohortMonth] = 0;
      }
    }

    return {
      cohortMonths,
      retention,
      revenue,
      churn,
      summary: {
        cohortSizes,
        bestRetentionCohort: best,
        worstRetentionCohort: worst,
        averageRetentionPctByCohort,
      },
    };
  }

  exportToCsv(cohortMonth: string, kind: 'retention' | 'revenue' | 'churn'): string {
    if (kind === 'retention') {
      const rows = this.getRetentionCurve(cohortMonth);
      const header = 'cohortMonth,monthOffset,activeCustomers,retentionPct';
      const lines = rows.map(
        (r) => `${cohortMonth},${r.monthOffset},${r.activeCustomers},${r.retentionPct.toFixed(2)}`,
      );
      return [header, ...lines].join('\n');
    }
    if (kind === 'revenue') {
      const rows = this.getRevenueCohort(cohortMonth);
      const header = 'cohortMonth,monthOffset,totalRevenue,averageRevenuePerCustomer,activeCustomers';
      const lines = rows.map(
        (r) =>
          `${cohortMonth},${r.monthOffset},${r.totalRevenue.toFixed(2)},${r.averageRevenuePerCustomer.toFixed(2)},${r.activeCustomers}`,
      );
      return [header, ...lines].join('\n');
    }
    const rows = this.getChurnCohort(cohortMonth);
    const header = 'cohortMonth,monthOffset,churnedCustomers,churnRatePct,cumulativeChurnRatePct';
    const lines = rows.map(
      (r) =>
        `${cohortMonth},${r.monthOffset},${r.churnedCustomers},${r.churnRatePct.toFixed(2)},${r.cumulativeChurnRatePct.toFixed(2)}`,
    );
    return [header, ...lines].join('\n');
  }

  // ---- internals ----

  private validateEvent(event: SubscriptionLifecycleEvent): void {
    if (typeof event.subscriptionId !== 'string' || event.subscriptionId.length === 0) {
      throw new Error('subscriptionId is required');
    }
    if (typeof event.customerId !== 'string' || event.customerId.length === 0) {
      throw new Error('customerId is required');
    }
    if (!LIFECYCLE_EVENTS.includes(event.event)) {
      throw new Error(`event must be one of ${LIFECYCLE_EVENTS.join(', ')}`);
    }
    if (typeof event.amount !== 'number' || Number.isNaN(event.amount) || event.amount < 0) {
      throw new Error('amount must be a non-negative number');
    }
    if (typeof event.currency !== 'string' || event.currency.length === 0) {
      throw new Error('currency is required');
    }
    if (!(event.occurredAt instanceof Date) || Number.isNaN(event.occurredAt.getTime())) {
      throw new Error('occurredAt must be a valid Date');
    }
  }

  /**
   * Builds per-customer state: cohort month (calendar month of the customer's
   * FIRST `started` event, across all their subscriptions) and their full event
   * history, sorted chronologically.
   *
   * Customers with no `started` event are ignored — they cannot be assigned a
   * cohort and are excluded from all cohort analysis.
   */
  private buildCustomerStates(): Map<string, CustomerState> {
    const byCustomer = new Map<string, SubscriptionLifecycleEvent[]>();
    for (const event of this.events) {
      const list = byCustomer.get(event.customerId) ?? [];
      list.push(event);
      byCustomer.set(event.customerId, list);
    }

    const states = new Map<string, CustomerState>();
    for (const [customerId, events] of byCustomer.entries()) {
      const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      const firstStarted = sorted.find((e) => e.event === 'started');
      if (!firstStarted) continue; // no cohort can be assigned
      states.set(customerId, {
        customerId,
        cohortMonth: monthKey(firstStarted.occurredAt),
        events: sorted,
      });
    }
    return states;
  }

  private customersInCohort(cohortMonth: string): CustomerState[] {
    return Array.from(this.buildCustomerStates().values()).filter((c) => c.cohortMonth === cohortMonth);
  }

  /**
   * The furthest month-offset worth reporting for a cohort: the offset of the
   * most recent lifecycle event across the cohort's customers (so the curve
   * doesn't trail off into offsets with no data). Always at least 0.
   */
  private maxOffsetForCohort(cohortMonth: string): number {
    const cohortCustomers = this.customersInCohort(cohortMonth);
    let max = 0;
    for (const customer of cohortCustomers) {
      for (const event of customer.events) {
        const offset = monthDiff(cohortMonth, monthKey(event.occurredAt));
        if (offset > max) max = offset;
      }
    }
    return max;
  }

  /**
   * A customer is considered "active" in a given offset month if, as of that
   * month, they have not churned — i.e. their most recent lifecycle event
   * *at or before* that offset month is not a `cancelled` event.
   *
   * Re-subscribe rule: if a customer cancels and later has a new `started` or
   * `renewed` event in a later month, they are counted active again from that
   * month onward (their most-recent-event-wins). They remain assigned to their
   * ORIGINAL signup cohort — re-subscribing does not create a new cohort. See
   * docs/COHORT_ANALYTICS.md for the full rationale.
   */
  private isActiveInOffsetMonth(customer: CustomerState, cohortMonth: string, offset: number): boolean {
    const targetMonth = addMonths(cohortMonth, offset);
    // Events at or before the end of the target month, chronological order.
    const relevant = customer.events.filter((e) => monthDiff(monthKey(e.occurredAt), targetMonth) >= 0);
    if (relevant.length === 0) return false;

    const mostRecent = relevant[relevant.length - 1];
    return mostRecent.event !== 'cancelled';
  }
}

export const cohortAnalyticsService = new CohortAnalyticsService();
