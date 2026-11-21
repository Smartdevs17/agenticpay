/**
 * installments.test.ts — Issue #919: BNPL installment plans
 *
 * Covers the pure schedule math, request validation, and the plan lifecycle
 * (create → collect → complete / fail / cancel / sweep).
 */
import { describe, expect, it, beforeEach } from 'vitest';

import {
  BNPLInstallmentService,
  DEFAULT_BNPL_CONFIG,
  InMemoryInstallmentPlanRepository,
  addPeriod,
  buildInstallmentSchedule,
  isPlanOverdue,
  nextActionableInstallment,
  roundCurrency,
  summarizePlan,
  validateInstallmentRequest,
} from './index.js';
import type { InstallmentPlanEvent, InstallmentEventPublisher } from './types.js';

class CapturingPublisher implements InstallmentEventPublisher {
  events: InstallmentPlanEvent[] = [];
  publish(event: InstallmentPlanEvent): void {
    this.events.push(event);
  }
}

const FIXED_NOW = new Date('2026-09-27T00:00:00.000Z');

function makeService(options: { publisher?: InstallmentEventPublisher } = {}) {
  return new BNPLInstallmentService({
    repository: new InMemoryInstallmentPlanRepository(),
    publisher: options.publisher,
    now: () => FIXED_NOW,
    idFactory: (() => {
      let counter = 0;
      return () => `plan-${++counter}`;
    })(),
  });
}

describe('roundCurrency', () => {
  it('rounds to two decimals without drifting', () => {
    expect(roundCurrency(33.333333)).toBe(33.33);
    expect(roundCurrency(33.335)).toBe(33.34);
    expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
  });
});

describe('addPeriod', () => {
  it('adds fixed day windows for weekly and biweekly frequencies', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    expect(addPeriod(start, 'weekly', 1).toISOString()).toBe('2026-01-08T00:00:00.000Z');
    expect(addPeriod(start, 'biweekly', 2).toISOString()).toBe('2026-01-29T00:00:00.000Z');
  });

  it('preserves day-of-month for monthly frequency', () => {
    const jan15 = new Date('2026-01-15T00:00:00.000Z');
    expect(addPeriod(jan15, 'monthly', 1).toISOString()).toBe('2026-02-15T00:00:00.000Z');
  });

  it('clamps monthly additions that overflow a shorter month', () => {
    const jan31 = new Date('2026-01-31T00:00:00.000Z');
    expect(addPeriod(jan31, 'monthly', 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
});

describe('buildInstallmentSchedule', () => {
  it('splits an amount that divides evenly', () => {
    const schedule = buildInstallmentSchedule({
      financedAmount: 120,
      installmentCount: 4,
      frequency: 'monthly',
      startDate: '2026-01-01T00:00:00.000Z',
    });

    expect(schedule.map((entry) => entry.amount)).toEqual([30, 30, 30, 30]);
    expect(schedule[0].dueAt).toBe('2026-01-01T00:00:00.000Z');
    expect(schedule[3].dueAt).toBe('2026-04-01T00:00:00.000Z');
  });

  it('reconciles rounding remainders into the final installment', () => {
    const schedule = buildInstallmentSchedule({
      financedAmount: 100,
      installmentCount: 3,
      frequency: 'monthly',
      startDate: '2026-01-01T00:00:00.000Z',
    });

    expect(schedule.map((entry) => entry.amount)).toEqual([33.33, 33.33, 33.34]);
    const total = roundCurrency(schedule.reduce((sum, entry) => sum + entry.amount, 0));
    expect(total).toBe(100);
  });

  it('keeps a low-denomination split exact', () => {
    const schedule = buildInstallmentSchedule({
      financedAmount: 10.01,
      installmentCount: 6,
      frequency: 'weekly',
      startDate: '2026-01-01T00:00:00.000Z',
    });
    const total = roundCurrency(schedule.reduce((sum, entry) => sum + entry.amount, 0));
    expect(total).toBe(10.01);
  });

  it('rejects a non-positive installment count', () => {
    expect(() =>
      buildInstallmentSchedule({
        financedAmount: 100,
        installmentCount: 0,
        frequency: 'monthly',
        startDate: FIXED_NOW,
      }),
    ).toThrow(/greater than zero/);
  });
});

describe('validateInstallmentRequest', () => {
  const base = {
    tenantId: 'tenant-1',
    amount: 300,
    installmentCount: 3,
    startDate: '2026-01-01T00:00:00.000Z',
  };

  it('applies defaults for currency, frequency and down payment', () => {
    const result = validateInstallmentRequest(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currency).toBe('USD');
    expect(result.value.frequency).toBe('monthly');
    expect(result.value.downPayment).toBe(0);
    expect(result.value.financedAmount).toBe(300);
  });

  it('computes the financed amount net of a down payment', () => {
    const result = validateInstallmentRequest({ ...base, amount: 500, downPayment: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.financedAmount).toBe(400);
  });

  it('rejects a missing tenant', () => {
    const result = validateInstallmentRequest({ ...base, tenantId: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects non-positive amounts', () => {
    expect(validateInstallmentRequest({ ...base, amount: 0 }).ok).toBe(false);
    expect(validateInstallmentRequest({ ...base, amount: -5 }).ok).toBe(false);
  });

  it('rejects installment counts outside the configured bounds', () => {
    expect(validateInstallmentRequest({ ...base, installmentCount: 1 }).ok).toBe(false);
    expect(validateInstallmentRequest({ ...base, installmentCount: 13 }).ok).toBe(false);
  });

  it('rejects unsupported frequencies and currencies', () => {
    expect(
      validateInstallmentRequest({ ...base, frequency: 'daily' as never }).ok,
    ).toBe(false);
    expect(validateInstallmentRequest({ ...base, currency: 'JPY' }).ok).toBe(false);
  });

  it('rejects a down payment that is not smaller than the amount', () => {
    expect(validateInstallmentRequest({ ...base, downPayment: 300 }).ok).toBe(false);
    expect(validateInstallmentRequest({ ...base, downPayment: 350 }).ok).toBe(false);
  });

  it('enforces the financed amount floor and ceiling', () => {
    expect(validateInstallmentRequest({ ...base, amount: 5 }).ok).toBe(false);
    expect(
      validateInstallmentRequest({ ...base, amount: DEFAULT_BNPL_CONFIG.maxFinancedAmount + 1 }).ok,
    ).toBe(false);
  });

  it('rejects an invalid start date', () => {
    expect(validateInstallmentRequest({ ...base, startDate: 'not-a-date' }).ok).toBe(false);
  });
});

describe('BNPLInstallmentService', () => {
  let publisher: CapturingPublisher;
  let service: BNPLInstallmentService;

  beforeEach(() => {
    publisher = new CapturingPublisher();
    service = makeService({ publisher });
  });

  async function createPlan(overrides: Record<string, unknown> = {}) {
    const result = await service.createPlan({
      tenantId: 'tenant-1',
      amount: 300,
      installmentCount: 3,
      startDate: '2026-01-01T00:00:00.000Z',
      ...overrides,
    });
    if (!result.ok) throw new Error(`createPlan failed: ${result.error.message}`);
    return result.value;
  }

  it('creates a plan whose schedule sums to the financed amount', async () => {
    const plan = await createPlan();

    expect(plan.id).toBe('plan-1');
    expect(plan.status).toBe('active');
    expect(plan.installments).toHaveLength(3);
    expect(plan.financedAmount).toBe(300);
    expect(roundCurrency(plan.installments.reduce((sum, i) => sum + i.amount, 0))).toBe(300);
    expect(publisher.events.map((event) => event.type)).toContain('installment_plan.created');
  });

  it('does not persist a plan when validation fails', async () => {
    const result = await service.createPlan({
      tenantId: 'tenant-1',
      amount: 300,
      installmentCount: 1,
      startDate: '2026-01-01T00:00:00.000Z',
    });
    expect(result.ok).toBe(false);
    const listed = await service.listPlans('tenant-1');
    expect(listed.ok && listed.value).toHaveLength(0);
  });

  it('scopes plan reads to the owning tenant', async () => {
    const plan = await createPlan();
    const other = await service.getPlan('tenant-2', plan.id);
    expect(other.ok).toBe(false);
    if (other.ok) return;
    expect(other.error.code).toBe('NOT_FOUND');
  });

  it('lists plans filtered by status and customer', async () => {
    await createPlan({ customerId: 'cust-1' });
    await createPlan({ customerId: 'cust-2' });

    const byCustomer = await service.listPlans('tenant-1', { customerId: 'cust-1' });
    expect(byCustomer.ok && byCustomer.value).toHaveLength(1);

    await service.cancelPlan('tenant-1', 'plan-1', 'requested');
    const activeOnly = await service.listPlans('tenant-1', { status: 'active' });
    expect(activeOnly.ok && activeOnly.value).toHaveLength(1);
    expect(activeOnly.ok && activeOnly.value[0].id).toBe('plan-2');
  });

  it('collects installments in order and completes the plan on the final one', async () => {
    const plan = await createPlan({ installmentCount: 2, amount: 200 });

    const first = await service.payInstallment('tenant-1', plan.id, { installmentIndex: 1, paymentId: 'pay-1' });
    expect(first.ok).toBe(true);
    expect(first.ok && first.value.status).toBe('active');
    expect(first.ok && first.value.installments[0].status).toBe('paid');

    const second = await service.payInstallment('tenant-1', plan.id, { installmentIndex: 2, paymentId: 'pay-2' });
    expect(second.ok && second.value.status).toBe('completed');

    const types = publisher.events.map((event) => event.type);
    expect(types).toContain('installment.paid');
    expect(types).toContain('installment_plan.completed');
  });

  it('rejects collecting the same installment twice', async () => {
    const plan = await createPlan();
    await service.payInstallment('tenant-1', plan.id, { installmentIndex: 1 });
    const again = await service.payInstallment('tenant-1', plan.id, { installmentIndex: 1 });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('CONFLICT');
  });

  it('rejects collecting an unknown installment index', async () => {
    const plan = await createPlan();
    const result = await service.payInstallment('tenant-1', plan.id, { installmentIndex: 99 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects collecting on a cancelled plan', async () => {
    const plan = await createPlan();
    await service.cancelPlan('tenant-1', plan.id, 'customer changed mind');
    const result = await service.payInstallment('tenant-1', plan.id, { installmentIndex: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT');
  });

  it('records a failed collection and lets it be retried later', async () => {
    const plan = await createPlan();
    const failed = await service.markInstallmentFailed('tenant-1', plan.id, 1, 'card declined');
    expect(failed.ok).toBe(true);
    expect(failed.ok && failed.value.installments[0].status).toBe('failed');
    expect(failed.ok && failed.value.installments[0].failureReason).toBe('card declined');

    const retried = await service.payInstallment('tenant-1', plan.id, { installmentIndex: 1, paymentId: 'pay-retry' });
    expect(retried.ok).toBe(true);
    expect(retried.ok && retried.value.installments[0].status).toBe('paid');
    expect(retried.ok && retried.value.installments[0].failureReason).toBeNull();
  });

  it('voids outstanding installments when a plan is cancelled', async () => {
    const plan = await createPlan();
    await service.payInstallment('tenant-1', plan.id, { installmentIndex: 1 });
    const cancelled = await service.cancelPlan('tenant-1', plan.id, 'fraud review');

    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.value.status).toBe('cancelled');
    expect(cancelled.value.installments[0].status).toBe('paid');
    expect(cancelled.value.installments.slice(1).every((i) => i.status === 'cancelled')).toBe(true);
    expect(publisher.events.map((event) => event.type)).toContain('installment_plan.cancelled');
  });

  it('refuses to cancel an already completed plan', async () => {
    const plan = await createPlan({ installmentCount: 2, amount: 200 });
    await service.payInstallment('tenant-1', plan.id, { installmentIndex: 1 });
    await service.payInstallment('tenant-1', plan.id, { installmentIndex: 2 });
    const result = await service.cancelPlan('tenant-1', plan.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT');
  });

  it('flags overdue installments exactly once', async () => {
    const plan = await createPlan({
      installmentCount: 3,
      amount: 300,
      frequency: 'monthly',
      startDate: '2026-01-01T00:00:00.000Z',
    });

    const sweep = await service.sweepOverdue('tenant-1', new Date('2026-02-15T00:00:00.000Z'));
    expect(sweep.ok && sweep.value.flagged).toBe(2);

    const stored = await service.getPlan('tenant-1', plan.id);
    expect(stored.ok && stored.value.installments[0].status).toBe('due');
    expect(stored.ok && stored.value.installments[1].status).toBe('due');
    expect(stored.ok && stored.value.installments[2].status).toBe('scheduled');

    const secondSweep = await service.sweepOverdue('tenant-1', new Date('2026-02-15T00:00:00.000Z'));
    expect(secondSweep.ok && secondSweep.value.flagged).toBe(0);
  });

  it('summarises repayment progress', async () => {
    const plan = await createPlan({ installmentCount: 4, amount: 400 });
    await service.payInstallment('tenant-1', plan.id, { installmentIndex: 1 });

    const summary = await service.getSummary('tenant-1', plan.id);
    expect(summary.ok).toBe(true);
    if (!summary.ok) return;
    expect(summary.value.paidAmount).toBe(100);
    expect(summary.value.remainingAmount).toBe(300);
    expect(summary.value.paidCount).toBe(1);
    expect(summary.value.outstandingCount).toBe(3);
    expect(summary.value.progressPercent).toBe(25);
    expect(summary.value.nextDueAt).toBe(plan.installments[1].dueAt);
  });
});

describe('plan helpers', () => {
  it('identifies the next outstanding installment and overdue plans', async () => {
    const service = makeService();
    const created = await service.createPlan({
      tenantId: 'tenant-1',
      amount: 200,
      installmentCount: 2,
      frequency: 'weekly',
      startDate: '2026-01-01T00:00:00.000Z',
    });
    if (!created.ok) throw new Error('plan creation failed');

    const plan = created.value;
    expect(nextActionableInstallment(plan)?.index).toBe(1);
    expect(isPlanOverdue(plan, new Date('2025-12-31T00:00:00.000Z'))).toBe(false);
    expect(isPlanOverdue(plan, new Date('2026-01-02T00:00:00.000Z'))).toBe(true);

    const summary = summarizePlan(plan);
    expect(summary.totalAmount).toBe(200);
    expect(summary.remainingAmount).toBe(200);
    expect(summary.progressPercent).toBe(0);
  });
});
