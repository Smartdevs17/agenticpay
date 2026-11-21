// reconciliation.test.ts — Issue #628
//
// Unit tests for the reconciliation matching engine and the reconciliation
// service's exception workflow / reporting / analytics. Run without
// DATABASE_URL set so the service exercises its in-memory fallback path.

import { beforeEach, describe, expect, it } from 'vitest';
import { runMatchingEngine, type MatchCandidate } from '../payment-reconciliation/matching-engine.js';
import { ReconciliationService, type InternalPaymentLike } from '../payment-reconciliation/reconciliation-service.js';

function candidate(overrides: Partial<MatchCandidate>): MatchCandidate {
  return {
    id: overrides.id ?? `c_${Math.random().toString(36).slice(2)}`,
    source: overrides.source ?? 'internal',
    externalRef: overrides.externalRef ?? null,
    paymentId: overrides.paymentId ?? null,
    amount: overrides.amount ?? 100,
    currency: overrides.currency ?? 'USD',
    occurredAt: overrides.occurredAt ?? new Date('2026-07-01T12:00:00Z'),
  };
}

describe('runMatchingEngine', () => {
  it('exact-matches on identical external reference / tx hash', () => {
    const internal = [candidate({ id: 'i1', externalRef: 'tx_abc', amount: 100 })];
    const external = [
      candidate({ id: 'e1', source: 'bank_statement', externalRef: 'tx_abc', amount: 100, occurredAt: new Date('2026-07-05T00:00:00Z') }),
    ];

    const outcome = runMatchingEngine(internal, external);
    expect(outcome.matches).toHaveLength(1);
    expect(outcome.matches[0]).toMatchObject({ internalId: 'i1', externalId: 'e1', matchType: 'exact', confidence: 1 });
    expect(outcome.unmatchedInternal).toHaveLength(0);
    expect(outcome.unmatchedExternal).toHaveLength(0);
  });

  it('exact-matches on identical amount within the tight date window when no reference is present', () => {
    const internal = [candidate({ id: 'i1', amount: 250, occurredAt: new Date('2026-07-01T12:00:00Z') })];
    const external = [
      candidate({ id: 'e1', source: 'psp_settlement', amount: 250, occurredAt: new Date('2026-07-01T12:02:00Z') }),
    ];

    const outcome = runMatchingEngine(internal, external);
    expect(outcome.matches).toHaveLength(1);
    expect(outcome.matches[0].matchType).toBe('exact');
    expect(outcome.matches[0].confidence).toBe(1);
  });

  it('does not exact-match identical amounts outside the tight date window (falls to fuzzy or exception)', () => {
    const internal = [candidate({ id: 'i1', amount: 250, occurredAt: new Date('2026-07-01T00:00:00Z') })];
    const external = [
      candidate({ id: 'e1', source: 'psp_settlement', amount: 250, occurredAt: new Date('2026-07-01T01:00:00Z') }),
    ];

    const outcome = runMatchingEngine(internal, external);
    // Amount is identical (0% delta) so it still clears fuzzy tolerance, but as a fuzzy match not exact.
    expect(outcome.matches).toHaveLength(1);
    expect(outcome.matches[0].matchType).toBe('fuzzy');
  });

  it('fuzzy-matches amounts within tolerance and a confidence score in (0,1]', () => {
    const internal = [candidate({ id: 'i1', amount: 1000, occurredAt: new Date('2026-07-01T00:00:00Z') })];
    const external = [
      candidate({
        id: 'e1',
        source: 'bank_statement',
        amount: 1005, // 0.5% delta, within default 2% tolerance
        occurredAt: new Date('2026-07-02T00:00:00Z'),
      }),
    ];

    const outcome = runMatchingEngine(internal, external);
    expect(outcome.matches).toHaveLength(1);
    expect(outcome.matches[0].matchType).toBe('fuzzy');
    expect(outcome.matches[0].confidence).toBeGreaterThan(0);
    expect(outcome.matches[0].confidence).toBeLessThan(1);
    expect(outcome.matches[0].amountDelta).toBeCloseTo(5, 6);
  });

  it('does not match amounts outside tolerance — left as unmatched exceptions', () => {
    const internal = [candidate({ id: 'i1', amount: 1000 })];
    const external = [candidate({ id: 'e1', source: 'bank_statement', amount: 1100 })]; // 10% delta

    const outcome = runMatchingEngine(internal, external);
    expect(outcome.matches).toHaveLength(0);
    expect(outcome.unmatchedInternal.map((c) => c.id)).toEqual(['i1']);
    expect(outcome.unmatchedExternal.map((c) => c.id)).toEqual(['e1']);
  });

  it('respects the amount tolerance boundary (inclusive)', () => {
    const internal = [candidate({ id: 'i1', amount: 1000, occurredAt: new Date('2026-07-01T00:00:00Z') })];
    // Exactly at the default 2% tolerance boundary.
    const external = [
      candidate({ id: 'e1', source: 'bank_statement', amount: 1020, occurredAt: new Date('2026-07-01T00:00:00Z') }),
    ];

    const outcome = runMatchingEngine(internal, external, { amountTolerancePct: 0.02 });
    expect(outcome.matches).toHaveLength(1);
  });

  it('does not match just beyond the tolerance boundary', () => {
    const internal = [candidate({ id: 'i1', amount: 1000, occurredAt: new Date('2026-07-01T00:00:00Z') })];
    const external = [
      candidate({ id: 'e1', source: 'bank_statement', amount: 1020.01, occurredAt: new Date('2026-07-01T00:00:00Z') }),
    ];

    const outcome = runMatchingEngine(internal, external, { amountTolerancePct: 0.02 });
    expect(outcome.matches).toHaveLength(0);
  });

  it('never matches across currencies even when amount and date align exactly', () => {
    const internal = [candidate({ id: 'i1', amount: 500, currency: 'USD' })];
    const external = [candidate({ id: 'e1', source: 'bank_statement', amount: 500, currency: 'EUR' })];

    const outcome = runMatchingEngine(internal, external);
    expect(outcome.matches).toHaveLength(0);
    expect(outcome.unmatchedInternal).toHaveLength(1);
    expect(outcome.unmatchedExternal).toHaveLength(1);
  });

  it('only matches one external record per duplicate reference, leaving the rest as exceptions', () => {
    const internal = [
      candidate({ id: 'i1', externalRef: 'dup_ref', amount: 100 }),
      candidate({ id: 'i2', externalRef: 'dup_ref', amount: 100 }),
    ];
    const external = [candidate({ id: 'e1', source: 'bank_statement', externalRef: 'dup_ref', amount: 100 })];

    const outcome = runMatchingEngine(internal, external);
    expect(outcome.matches).toHaveLength(1);
    expect(outcome.unmatchedInternal).toHaveLength(1);
    expect(outcome.unmatchedExternal).toHaveLength(0);
  });

  it('leaves split payments unmatched (no partial/sum matching support)', () => {
    // One internal payment of 100 that was actually settled as two external partials of 60 + 40.
    const internal = [candidate({ id: 'i1', amount: 100 })];
    const external = [
      candidate({ id: 'e1', source: 'bank_statement', amount: 60 }),
      candidate({ id: 'e2', source: 'bank_statement', amount: 40 }),
    ];

    const outcome = runMatchingEngine(internal, external);
    expect(outcome.matches).toHaveLength(0);
    expect(outcome.unmatchedInternal.map((c) => c.id)).toEqual(['i1']);
    expect(outcome.unmatchedExternal.map((c) => c.id).sort()).toEqual(['e1', 'e2']);
  });

  it('prefers the higher-confidence fuzzy pairing when multiple candidates are viable', () => {
    const internal = [candidate({ id: 'i1', amount: 1000, occurredAt: new Date('2026-07-01T00:00:00Z') })];
    const external = [
      candidate({ id: 'far', source: 'bank_statement', amount: 1015, occurredAt: new Date('2026-07-03T00:00:00Z') }),
      candidate({ id: 'close', source: 'bank_statement', amount: 1002, occurredAt: new Date('2026-07-01T00:05:00Z') }),
    ];

    const outcome = runMatchingEngine(internal, external);
    expect(outcome.matches).toHaveLength(1);
    expect(outcome.matches[0].externalId).toBe('close');
  });
});

describe('ReconciliationService (in-memory fallback)', () => {
  let service: ReconciliationService;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    service = new ReconciliationService();
  });

  function payment(overrides: Partial<InternalPaymentLike>): InternalPaymentLike {
    return {
      id: overrides.id ?? `pay_${Math.random().toString(36).slice(2)}`,
      tenantId: overrides.tenantId ?? 't1',
      txHash: overrides.txHash ?? null,
      amount: overrides.amount ?? 100,
      currency: overrides.currency ?? 'USD',
      createdAt: overrides.createdAt ?? new Date('2026-07-15T10:00:00Z'),
    };
  }

  describe('runBatch', () => {
    it('creates a completed batch with no exceptions when everything matches', async () => {
      service.seedPayments([payment({ id: 'p1', txHash: 'tx1', amount: 500 })]);

      const result = await service.runBatch({
        tenantId: 't1',
        periodStart: '2026-07-15T00:00:00Z',
        periodEnd: '2026-07-16T00:00:00Z',
        externalRecords: [
          { source: 'bank_statement', externalRef: 'tx1', amount: 500, currency: 'USD', occurredAt: '2026-07-15T10:05:00Z' },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe('completed');
      expect(result.value.totalRecords).toBe(2);
      expect(result.value.matchedCount).toBe(1);
      expect(result.value.exceptionCount).toBe(0);
      expect(result.value.matches).toHaveLength(1);
    });

    it('creates exceptions for unmatched records and marks batch completed_with_exceptions', async () => {
      service.seedPayments([payment({ id: 'p1', amount: 500 }), payment({ id: 'p2', amount: 750 })]);

      const result = await service.runBatch({
        tenantId: 't1',
        periodStart: '2026-07-15T00:00:00Z',
        periodEnd: '2026-07-16T00:00:00Z',
        externalRecords: [
          { source: 'bank_statement', amount: 500, currency: 'USD', occurredAt: '2026-07-15T10:00:00Z' },
          { source: 'bank_statement', amount: 999, currency: 'USD', occurredAt: '2026-07-15T10:00:00Z' },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe('completed_with_exceptions');
      // p1<->500 matches exactly; p2 (750) and the 999 external record are left unmatched.
      expect(result.value.matchedCount).toBe(1);
      expect(result.value.exceptionCount).toBe(2);
      expect(result.value.exceptions.map((e) => e.reason).sort()).toEqual([
        'no_matching_external_record',
        'no_matching_internal_record',
      ]);
    });

    it('only ingests internal payments within the requested period', async () => {
      service.seedPayments([
        payment({ id: 'in-period', amount: 100, createdAt: new Date('2026-07-15T10:00:00Z') }),
        payment({ id: 'out-of-period', amount: 200, createdAt: new Date('2026-08-01T10:00:00Z') }),
      ]);

      const result = await service.runBatch({
        tenantId: 't1',
        periodStart: '2026-07-15T00:00:00Z',
        periodEnd: '2026-07-16T00:00:00Z',
        externalRecords: [],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.records.some((r) => r.paymentId === 'out-of-period')).toBe(false);
      expect(result.value.records.some((r) => r.paymentId === 'in-period')).toBe(true);
    });

    it('rejects an invalid period', async () => {
      const result = await service.runBatch({
        tenantId: 't1',
        periodStart: '2026-07-16T00:00:00Z',
        periodEnd: '2026-07-15T00:00:00Z',
        externalRecords: [],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(400);
    });
  });

  describe('exception workflow', () => {
    async function seedBatchWithException() {
      service.seedPayments([payment({ id: 'p1', amount: 500 })]);
      const result = await service.runBatch({
        tenantId: 't1',
        periodStart: '2026-07-15T00:00:00Z',
        periodEnd: '2026-07-16T00:00:00Z',
        externalRecords: [],
      });
      if (!result.ok) throw new Error('setup failed');
      return result.value.exceptions[0];
    }

    it('assigns an owner and transitions to investigating', async () => {
      const exception = await seedBatchWithException();
      const updated = await service.updateException(exception.id, { status: 'investigating', assignedTo: 'ops_1' });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.value.status).toBe('investigating');
      expect(updated.value.assignedTo).toBe('ops_1');
      expect(updated.value.resolvedAt).toBeNull();
    });

    it('stamps resolvedAt when marked resolved, with a resolution note', async () => {
      const exception = await seedBatchWithException();
      const updated = await service.updateException(exception.id, {
        status: 'resolved',
        resolutionNote: 'Manually matched against late bank feed entry.',
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.value.status).toBe('resolved');
      expect(updated.value.resolvedAt).not.toBeNull();
      expect(updated.value.resolutionNote).toContain('Manually matched');
    });

    it('clears resolvedAt when moved back out of a terminal status', async () => {
      const exception = await seedBatchWithException();
      await service.updateException(exception.id, { status: 'written_off' });
      const reopened = await service.updateException(exception.id, { status: 'open' });
      expect(reopened.ok).toBe(true);
      if (!reopened.ok) return;
      expect(reopened.value.resolvedAt).toBeNull();
    });

    it('returns NOT_FOUND for an unknown exception id', async () => {
      const result = await service.updateException('does-not-exist', { status: 'resolved' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(404);
    });

    it('lists exceptions filtered by status', async () => {
      const exception = await seedBatchWithException();
      await service.updateException(exception.id, { status: 'investigating' });

      const open = await service.listExceptions({ tenantId: 't1', status: 'open' });
      const investigating = await service.listExceptions({ tenantId: 't1', status: 'investigating' });
      expect(open.ok && open.value).toHaveLength(0);
      expect(investigating.ok && investigating.value).toHaveLength(1);
    });
  });

  describe('reporting', () => {
    it('produces a batch report with match rate and per-source breakdown', async () => {
      service.seedPayments([payment({ id: 'p1', txHash: 'tx1', amount: 500 }), payment({ id: 'p2', amount: 750 })]);
      const run = await service.runBatch({
        tenantId: 't1',
        periodStart: '2026-07-15T00:00:00Z',
        periodEnd: '2026-07-16T00:00:00Z',
        externalRecords: [{ source: 'bank_statement', externalRef: 'tx1', amount: 500, currency: 'USD', occurredAt: '2026-07-15T10:00:00Z' }],
      });
      if (!run.ok) throw new Error('setup failed');

      const report = await service.getBatchReport(run.value.id);
      expect(report.ok).toBe(true);
      if (!report.ok) return;
      expect(report.value.totalRecords).toBe(3);
      expect(report.value.matchedCount).toBe(1);
      expect(report.value.exceptionCount).toBe(1);
      // 2 of 3 records matched (both sides of the one pair).
      expect(report.value.matchRatePct).toBeCloseTo((2 / 3) * 100, 1);
      const internalBreakdown = report.value.bySource.find((s) => s.source === 'internal');
      expect(internalBreakdown?.total).toBe(2);
    });

    it('returns NOT_FOUND for an unknown batch', async () => {
      const result = await service.getBatchDetail('missing');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.statusCode).toBe(404);
    });

    it('exports a batch report as CSV', async () => {
      service.seedPayments([payment({ id: 'p1', amount: 500 })]);
      const run = await service.runBatch({
        tenantId: 't1',
        periodStart: '2026-07-15T00:00:00Z',
        periodEnd: '2026-07-16T00:00:00Z',
        externalRecords: [],
      });
      if (!run.ok) throw new Error('setup failed');
      const report = await service.getBatchReport(run.value.id);
      if (!report.ok) throw new Error('report failed');

      const csv = service.reportToCsv(report.value);
      expect(csv).toContain('Batch');
      expect(csv).toContain(run.value.id);
    });
  });

  describe('analytics', () => {
    it('summarizes match rate, exception reasons, and trend across batches', async () => {
      service.seedPayments([
        payment({ id: 'p1', txHash: 'tx1', amount: 500, createdAt: new Date('2026-07-10T10:00:00Z') }),
        payment({ id: 'p2', amount: 900, createdAt: new Date('2026-07-15T10:00:00Z') }),
      ]);

      await service.runBatch({
        tenantId: 't1',
        periodStart: '2026-07-10T00:00:00Z',
        periodEnd: '2026-07-11T00:00:00Z',
        externalRecords: [{ source: 'bank_statement', externalRef: 'tx1', amount: 500, currency: 'USD', occurredAt: '2026-07-10T10:00:00Z' }],
      });
      const second = await service.runBatch({
        tenantId: 't1',
        periodStart: '2026-07-15T00:00:00Z',
        periodEnd: '2026-07-16T00:00:00Z',
        externalRecords: [],
      });
      if (!second.ok) throw new Error('setup failed');
      const exceptionId = second.value.exceptions[0].id;
      await service.updateException(exceptionId, { status: 'resolved', resolutionNote: 'ok' });

      const analytics = await service.getAnalytics({ tenantId: 't1' });
      expect(analytics.ok).toBe(true);
      if (!analytics.ok) return;
      expect(analytics.value.totalBatches).toBe(2);
      expect(analytics.value.totalRecords).toBe(3);
      expect(analytics.value.matchRatePct).toBeCloseTo((2 / 3) * 100, 1);
      expect(analytics.value.meanTimeToResolveExceptionsHours).not.toBeNull();
      expect(analytics.value.exceptionReasons.length).toBeGreaterThan(0);
      expect(analytics.value.trend).toHaveLength(2);
      // Trend is ordered by period start ascending.
      expect(new Date(analytics.value.trend[0].periodStart).getTime()).toBeLessThan(
        new Date(analytics.value.trend[1].periodStart).getTime(),
      );
    });

    it('returns a null MTTR when no exceptions have been resolved', async () => {
      service.seedPayments([payment({ id: 'p1', amount: 500 })]);
      await service.runBatch({
        tenantId: 't1',
        periodStart: '2026-07-15T00:00:00Z',
        periodEnd: '2026-07-16T00:00:00Z',
        externalRecords: [],
      });

      const analytics = await service.getAnalytics({ tenantId: 't1' });
      expect(analytics.ok).toBe(true);
      if (!analytics.ok) return;
      expect(analytics.value.meanTimeToResolveExceptionsHours).toBeNull();
    });
  });

  describe('getTenantsWithActivity', () => {
    it('returns distinct tenant ids with payments in the window', async () => {
      service.seedPayments([
        payment({ id: 'p1', tenantId: 'ta', createdAt: new Date('2026-07-15T05:00:00Z') }),
        payment({ id: 'p2', tenantId: 'ta', createdAt: new Date('2026-07-15T06:00:00Z') }),
        payment({ id: 'p3', tenantId: 'tb', createdAt: new Date('2026-07-15T07:00:00Z') }),
        payment({ id: 'p4', tenantId: 'tc', createdAt: new Date('2026-07-20T07:00:00Z') }),
      ]);

      const tenants = await service.getTenantsWithActivity(new Date('2026-07-15T00:00:00Z'), new Date('2026-07-16T00:00:00Z'));
      expect(tenants.sort()).toEqual(['ta', 'tb']);
    });
  });
});
