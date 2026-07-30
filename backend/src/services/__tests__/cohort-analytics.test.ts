import { beforeEach, describe, expect, it } from 'vitest';
import { CohortAnalyticsService, SubscriptionLifecycleEvent } from '../cohort-analytics.js';

function ev(overrides: Partial<SubscriptionLifecycleEvent> & Pick<SubscriptionLifecycleEvent, 'customerId' | 'event' | 'occurredAt'>): SubscriptionLifecycleEvent {
  return {
    subscriptionId: overrides.subscriptionId ?? `sub_${overrides.customerId}`,
    customerId: overrides.customerId,
    event: overrides.event,
    amount: overrides.amount ?? 10,
    currency: overrides.currency ?? 'USD',
    occurredAt: overrides.occurredAt,
    planId: overrides.planId,
  };
}

describe('CohortAnalyticsService', () => {
  let service: CohortAnalyticsService;

  beforeEach(() => {
    service = new CohortAnalyticsService();
  });

  describe('cohort assignment', () => {
    it('assigns a customer to the calendar month of their first started event', () => {
      service.trackMany([
        ev({ customerId: 'A', event: 'started', occurredAt: new Date('2025-01-05T00:00:00Z') }),
        ev({ customerId: 'B', event: 'started', occurredAt: new Date('2025-02-01T00:00:00Z') }),
      ]);

      const cohorts = service.getCohorts();
      expect(cohorts).toEqual([
        { cohortMonth: '2025-01', cohortSize: 1 },
        { cohortMonth: '2025-02', cohortSize: 1 },
      ]);
    });

    it('ignores customers with no started event', () => {
      service.track(ev({ customerId: 'X', event: 'renewed', occurredAt: new Date('2025-01-05T00:00:00Z') }));
      expect(service.getCohorts()).toEqual([]);
    });

    it('rejects an invalid event shape', () => {
      expect(() =>
        service.track(
          // @ts-expect-error - intentionally invalid event type for validation test
          ev({ customerId: 'A', event: 'bogus', occurredAt: new Date('2025-01-01T00:00:00Z') }),
        ),
      ).toThrow();
    });
  });

  describe('retention / revenue / churn math for a synthetic cohort', () => {
    // Cohort 2025-01: A, B, C.
    // A: started Jan, renewed Feb, renewed Mar -> stays active throughout.
    // B: started Jan, renewed Feb, cancelled Mar -> churns at offset 2.
    // C: started Jan, cancelled Feb, started again Mar -> churns at offset 1, re-subscribes at offset 2.
    beforeEach(() => {
      service.trackMany([
        ev({ customerId: 'A', event: 'started', amount: 10, occurredAt: new Date('2025-01-05T00:00:00Z') }),
        ev({ customerId: 'A', event: 'renewed', amount: 10, occurredAt: new Date('2025-02-05T00:00:00Z') }),
        ev({ customerId: 'A', event: 'renewed', amount: 10, occurredAt: new Date('2025-03-05T00:00:00Z') }),

        ev({ customerId: 'B', event: 'started', amount: 10, occurredAt: new Date('2025-01-10T00:00:00Z') }),
        ev({ customerId: 'B', event: 'renewed', amount: 10, occurredAt: new Date('2025-02-10T00:00:00Z') }),
        ev({ customerId: 'B', event: 'cancelled', amount: 0, occurredAt: new Date('2025-03-15T00:00:00Z') }),

        ev({ customerId: 'C', event: 'started', amount: 10, occurredAt: new Date('2025-01-20T00:00:00Z') }),
        ev({ customerId: 'C', event: 'cancelled', amount: 0, occurredAt: new Date('2025-02-25T00:00:00Z') }),
        ev({ customerId: 'C', event: 'started', amount: 10, occurredAt: new Date('2025-03-05T00:00:00Z') }),
      ]);
    });

    it('computes the retention curve, counting a re-subscribed customer as active again', () => {
      const curve = service.getRetentionCurve('2025-01');
      expect(curve).toEqual([
        { monthOffset: 0, activeCustomers: 3, retentionPct: 100 },
        { monthOffset: 1, activeCustomers: 2, retentionPct: (2 / 3) * 100 },
        { monthOffset: 2, activeCustomers: 2, retentionPct: (2 / 3) * 100 },
      ]);
    });

    it('computes revenue per cohort by month-offset from started+renewed amounts', () => {
      const revenue = service.getRevenueCohort('2025-01');
      expect(revenue).toEqual([
        { monthOffset: 0, totalRevenue: 30, averageRevenuePerCustomer: 10, activeCustomers: 3 },
        { monthOffset: 1, totalRevenue: 20, averageRevenuePerCustomer: 10, activeCustomers: 2 },
        { monthOffset: 2, totalRevenue: 20, averageRevenuePerCustomer: 10, activeCustomers: 2 },
      ]);
    });

    it('computes churn rate and cumulative churn rate per offset', () => {
      const churn = service.getChurnCohort('2025-01');

      expect(churn[0]).toEqual({
        monthOffset: 0,
        churnedCustomers: 0,
        churnRatePct: 0,
        cumulativeChurnRatePct: 0,
      });

      // C cancels in Feb (offset 1); active at start of offset 1 = active at offset 0 = 3.
      expect(churn[1].churnedCustomers).toBe(1);
      expect(churn[1].churnRatePct).toBeCloseTo((1 / 3) * 100, 5);
      expect(churn[1].cumulativeChurnRatePct).toBeCloseTo((1 / 3) * 100, 5);

      // B cancels in Mar (offset 2); active at start of offset 2 = active at offset 1 = 2.
      expect(churn[2].churnedCustomers).toBe(1);
      expect(churn[2].churnRatePct).toBeCloseTo((1 / 2) * 100, 5);
      // Distinct customers ever churned by offset 2: B and C -> 2 / 3 cohort size.
      expect(churn[2].cumulativeChurnRatePct).toBeCloseTo((2 / 3) * 100, 5);
    });
  });

  describe('cohort comparison', () => {
    beforeEach(() => {
      // Cohort 2025-01: A stays active, B churns at offset 2 (see above suite for full detail
      // — kept minimal and self-contained here instead).
      service.trackMany([
        ev({ customerId: 'A', event: 'started', amount: 10, occurredAt: new Date('2025-01-05T00:00:00Z') }),
        ev({ customerId: 'A', event: 'renewed', amount: 10, occurredAt: new Date('2025-02-05T00:00:00Z') }),

        // Cohort 2025-02: D stays active, E churns at offset 1.
        ev({ customerId: 'D', event: 'started', amount: 20, occurredAt: new Date('2025-02-01T00:00:00Z') }),
        ev({ customerId: 'D', event: 'renewed', amount: 20, occurredAt: new Date('2025-03-01T00:00:00Z') }),
        ev({ customerId: 'E', event: 'started', amount: 20, occurredAt: new Date('2025-02-10T00:00:00Z') }),
        ev({ customerId: 'E', event: 'cancelled', amount: 0, occurredAt: new Date('2025-03-12T00:00:00Z') }),
      ]);
    });

    it('returns retention/revenue/churn curves side-by-side with comparative stats', () => {
      const comparison = service.compareCohorts(['2025-01', '2025-02']);

      expect(comparison.cohortMonths).toEqual(['2025-01', '2025-02']);
      expect(comparison.summary.cohortSizes).toEqual({ '2025-01': 1, '2025-02': 2 });

      // 2025-02 cohort retention: offset0 = 100% (D,E both active), offset1 = 50% (only D).
      expect(comparison.retention['2025-02']).toEqual([
        { monthOffset: 0, activeCustomers: 2, retentionPct: 100 },
        { monthOffset: 1, activeCustomers: 1, retentionPct: 50 },
      ]);

      expect(comparison.summary.worstRetentionCohort).not.toBeNull();
      expect(comparison.summary.worstRetentionCohort?.retentionPct).toBe(50);
      expect(comparison.summary.worstRetentionCohort?.cohortMonth).toBe('2025-02');

      expect(comparison.summary.bestRetentionCohort?.retentionPct).toBe(100);

      expect(comparison.summary.averageRetentionPctByCohort['2025-01']).toBe(100);
      expect(comparison.summary.averageRetentionPctByCohort['2025-02']).toBe(75);
    });
  });

  describe('exportToCsv', () => {
    beforeEach(() => {
      service.trackMany([
        ev({ customerId: 'A', event: 'started', amount: 10, occurredAt: new Date('2025-01-05T00:00:00Z') }),
        ev({ customerId: 'A', event: 'renewed', amount: 10, occurredAt: new Date('2025-02-05T00:00:00Z') }),
      ]);
    });

    it('exports a retention CSV table with header + rows', () => {
      const csv = service.exportToCsv('2025-01', 'retention');
      const lines = csv.split('\n');
      expect(lines[0]).toBe('cohortMonth,monthOffset,activeCustomers,retentionPct');
      expect(lines[1]).toBe('2025-01,0,1,100.00');
      expect(lines[2]).toBe('2025-01,1,1,100.00');
    });

    it('exports a revenue CSV table with header + rows', () => {
      const csv = service.exportToCsv('2025-01', 'revenue');
      const lines = csv.split('\n');
      expect(lines[0]).toBe('cohortMonth,monthOffset,totalRevenue,averageRevenuePerCustomer,activeCustomers');
      expect(lines[1]).toBe('2025-01,0,10.00,10.00,1');
    });

    it('exports a churn CSV table with header + rows', () => {
      const csv = service.exportToCsv('2025-01', 'churn');
      const lines = csv.split('\n');
      expect(lines[0]).toBe('cohortMonth,monthOffset,churnedCustomers,churnRatePct,cumulativeChurnRatePct');
      expect(lines[1]).toBe('2025-01,0,0,0.00,0.00');
    });

    it('returns an empty header-only CSV for an unknown cohort', () => {
      const csv = service.exportToCsv('1999-01', 'retention');
      expect(csv).toBe('cohortMonth,monthOffset,activeCustomers,retentionPct');
    });
  });

  describe('resetForTests', () => {
    it('clears all tracked events', () => {
      service.track(ev({ customerId: 'A', event: 'started', occurredAt: new Date('2025-01-01T00:00:00Z') }));
      expect(service.getCohorts()).toHaveLength(1);
      service.resetForTests();
      expect(service.getCohorts()).toHaveLength(0);
    });
  });
});
