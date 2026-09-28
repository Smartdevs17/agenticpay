/**
 * recurring-billing.test.ts — Issue #918: Recurring payment schedules with
 * cron-based billing
 *
 * Covers cron resolution/validation, schedule creation, pause/resume/cancel,
 * rescheduling, preview, and due-run invoicing (success, cap and failure).
 */
import { describe, expect, it, beforeEach } from 'vitest';

import {
  DEFAULT_RECURRING_BILLING_CONFIG,
  InMemoryRecurringBillingStore,
  RecurringBillingService,
  isValidCronExpression,
  isValidTimezone,
  nextRunAfter,
  upcomingRuns,
  validateRecurringSchedule,
} from './index.js';
import type {
  RecurringBillingEvent,
  RecurringBillingPublisher,
  RecurringInvoice,
  RecurringInvoiceRepository,
} from './index.js';

class CapturingPublisher implements RecurringBillingPublisher {
  events: RecurringBillingEvent[] = [];
  publish(event: RecurringBillingEvent): void {
    this.events.push(event);
  }
}

const NOW = new Date('2026-09-28T12:00:00.000Z');

function makeService(
  options: { publisher?: RecurringBillingPublisher; clock?: { current: Date }; invoiceRepository?: RecurringInvoiceRepository } = {},
) {
  const clock = options.clock ?? { current: NOW };
  let counter = 0;
  const store = new InMemoryRecurringBillingStore();
  const service = new RecurringBillingService({
    repository: store,
    invoiceRepository: options.invoiceRepository ?? store,
    publisher: options.publisher ?? { publish: () => undefined },
    now: () => clock.current,
    idFactory: (() => {
      const prefixes = ['sched', 'inv'];
      return () => {
        counter += 1;
        return `${prefixes[counter % prefixes.length]}-${counter}`;
      };
    })(),
  });
  return { service, clock };
}

async function createDaily(service: RecurringBillingService, overrides: Record<string, unknown> = {}) {
  const result = await service.createSchedule({
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    amount: 49.99,
    currency: 'USD',
    preset: 'daily',
    ...overrides,
  });
  if (!result.ok) throw new Error(`createSchedule failed: ${result.error.message}`);
  return result.value;
}

describe('cron helpers', () => {
  it('validates cron expressions and timezones', () => {
    expect(isValidCronExpression('0 0 * * *')).toBe(true);
    expect(isValidCronExpression('not a cron')).toBe(false);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('Mars/Phobos')).toBe(false);
  });

  it('computes the next occurrence strictly after a reference time', () => {
    expect(nextRunAfter('0 0 * * *', 'UTC', NOW)?.toISOString()).toBe('2026-09-29T00:00:00.000Z');
    expect(nextRunAfter('0 0 1 * *', 'UTC', NOW)?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(nextRunAfter('invalid', 'UTC', NOW)).toBeNull();
  });

  it('lists multiple upcoming runs', () => {
    const runs = upcomingRuns('0 0 * * *', 'UTC', 3, NOW).map((date) => date.toISOString());
    expect(runs).toEqual([
      '2026-09-29T00:00:00.000Z',
      '2026-09-30T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
    ]);
    expect(upcomingRuns('0 0 * * *', 'UTC', 0, NOW)).toEqual([]);
  });
});

describe('validateRecurringSchedule', () => {
  const base = { tenantId: 'tenant-1', customerId: 'cust-1', amount: 10 };

  it('applies defaults for currency, timezone and cadence', () => {
    const result = validateRecurringSchedule(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currency).toBe('USD');
    expect(result.value.timezone).toBe('UTC');
    expect(result.value.cronExpression).toBe('0 0 1 * *'); // monthly preset
  });

  it('expands presets and accepts raw cron', () => {
    const weekly = validateRecurringSchedule({ ...base, preset: 'weekly' });
    expect(weekly.ok && weekly.value.cronExpression).toBe('0 0 * * 0');
    const raw = validateRecurringSchedule({ ...base, cronExpression: '*/15 * * * *' });
    expect(raw.ok && raw.value.cronExpression).toBe('*/15 * * * *');
  });

  it('rejects missing tenant/customer', () => {
    expect(validateRecurringSchedule({ ...base, tenantId: '' }).ok).toBe(false);
    expect(validateRecurringSchedule({ ...base, customerId: '' }).ok).toBe(false);
  });

  it('rejects non-positive and out-of-range amounts', () => {
    expect(validateRecurringSchedule({ ...base, amount: 0 }).ok).toBe(false);
    expect(validateRecurringSchedule({ ...base, amount: -1 }).ok).toBe(false);
    expect(validateRecurringSchedule({ ...base, amount: DEFAULT_RECURRING_BILLING_CONFIG.maxAmount + 1 }).ok).toBe(false);
  });

  it('rejects unsupported currencies', () => {
    expect(validateRecurringSchedule({ ...base, currency: 'JPY' }).ok).toBe(false);
  });

  it('rejects invalid cron expressions', () => {
    expect(validateRecurringSchedule({ ...base, cronExpression: 'nope' }).ok).toBe(false);
  });

  it('rejects an end date before the start date', () => {
    expect(
      validateRecurringSchedule({
        ...base,
        startAt: '2026-10-01T00:00:00Z',
        endAt: '2026-09-01T00:00:00Z',
      }).ok,
    ).toBe(false);
  });

  it('rejects a non-positive maxRuns', () => {
    expect(validateRecurringSchedule({ ...base, maxRuns: 0 }).ok).toBe(false);
    expect(validateRecurringSchedule({ ...base, maxRuns: 2.5 }).ok).toBe(false);
  });
});

describe('RecurringBillingService lifecycle', () => {
  let publisher: CapturingPublisher;
  let service: RecurringBillingService;

  beforeEach(() => {
    publisher = new CapturingPublisher();
    service = makeService({ publisher }).service;
  });

  it('creates an active schedule with the first run in the future', async () => {
    const schedule = await createDaily(service);
    expect(schedule.status).toBe('active');
    expect(schedule.cronExpression).toBe('0 0 * * *');
    expect(schedule.nextRunAt).toBe('2026-09-29T00:00:00.000Z');
    expect(schedule.runCount).toBe(0);
    expect(publisher.events.map((event) => event.type)).toContain('recurring_schedule.created');
  });

  it('honours an explicit start date as the first run boundary', async () => {
    const schedule = await createDaily(service, { startAt: '2026-10-05T00:00:00.000Z' });
    expect(schedule.nextRunAt).toBe('2026-10-05T00:00:00.000Z');
  });

  it('scopes reads to the owning tenant', async () => {
    const schedule = await createDaily(service);
    const other = await service.getSchedule('tenant-2', schedule.id);
    expect(other.ok).toBe(false);
  });

  it('filters schedules by status', async () => {
    const schedule = await createDaily(service);
    await service.pauseSchedule('tenant-1', schedule.id);

    const active = await service.listSchedules('tenant-1', { status: 'active' });
    expect(active.ok && active.value).toHaveLength(0);
    const paused = await service.listSchedules('tenant-1', { status: 'paused' });
    expect(paused.ok && paused.value).toHaveLength(1);
  });

  it('pauses and resumes a schedule', async () => {
    const schedule = await createDaily(service);
    const paused = await service.pauseSchedule('tenant-1', schedule.id);
    expect(paused.ok && paused.value.status).toBe('paused');

    // Resume recomputes the next run from "now".
    const resumed = await service.resumeSchedule('tenant-1', schedule.id);
    expect(resumed.ok && resumed.value.status).toBe('active');
    expect(resumed.ok && resumed.value.nextRunAt).toBe('2026-09-29T00:00:00.000Z');
    expect(publisher.events.map((event) => event.type)).toContain('recurring_schedule.resumed');
  });

  it('rejects pausing a non-active schedule', async () => {
    const schedule = await createDaily(service);
    await service.pauseSchedule('tenant-1', schedule.id);
    const again = await service.pauseSchedule('tenant-1', schedule.id);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('CONFLICT');
  });

  it('cancels a schedule and clears its next run', async () => {
    const schedule = await createDaily(service);
    const cancelled = await service.cancelSchedule('tenant-1', schedule.id, 'customer asked');
    expect(cancelled.ok && cancelled.value.status).toBe('cancelled');
    expect(cancelled.ok && cancelled.value.nextRunAt).toBeNull();
    expect(publisher.events.map((event) => event.type)).toContain('recurring_schedule.cancelled');
  });

  it('reschedules to a new cron cadence', async () => {
    const schedule = await createDaily(service);
    const rescheduled = await service.reschedule('tenant-1', schedule.id, { preset: 'monthly' });
    expect(rescheduled.ok && rescheduled.value.cronExpression).toBe('0 0 1 * *');
    expect(rescheduled.ok && rescheduled.value.nextRunAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('previews upcoming runs', async () => {
    const schedule = await createDaily(service);
    const preview = await service.previewUpcoming('tenant-1', schedule.id, 2);
    expect(preview.ok && preview.value.runs).toEqual([
      '2026-09-29T00:00:00.000Z',
      '2026-09-30T00:00:00.000Z',
    ]);
  });
});

describe('RecurringBillingService.runDue', () => {
  it('generates an invoice and advances the schedule', async () => {
    const publisher = new CapturingPublisher();
    const { service, clock } = makeService({ publisher });
    const schedule = await createDaily(service);

    clock.current = new Date('2026-09-29T00:00:00.000Z');
    const result = await service.runDue(clock.current);

    expect(result.ok && result.value.processed).toBe(1);
    if (!result.ok) return;
    expect(result.value.invoices).toHaveLength(1);
    expect(result.value.invoices[0].dueAt).toBe('2026-09-29T00:00:00.000Z');
    expect(result.value.invoices[0].status).toBe('pending');

    const refreshed = await service.getSchedule('tenant-1', schedule.id);
    expect(refreshed.ok && refreshed.value.runCount).toBe(1);
    expect(refreshed.ok && refreshed.value.nextRunAt).toBe('2026-09-30T00:00:00.000Z');
    expect(publisher.events.map((event) => event.type)).toContain('recurring_invoice.generated');

    const invoices = await service.listInvoices('tenant-1', schedule.id);
    expect(invoices.ok && invoices.value).toHaveLength(1);
  });

  it('completes a schedule once maxRuns is reached', async () => {
    const { service, clock } = makeService();
    const schedule = await createDaily(service, { maxRuns: 2 });

    clock.current = new Date('2026-09-29T00:00:00.000Z');
    await service.runDue(clock.current);
    clock.current = new Date('2026-09-30T00:00:00.000Z');
    const second = await service.runDue(clock.current);

    expect(second.ok && second.value.completedScheduleIds).toEqual([schedule.id]);
    const refreshed = await service.getSchedule('tenant-1', schedule.id);
    expect(refreshed.ok && refreshed.value.status).toBe('completed');
    expect(refreshed.ok && refreshed.value.nextRunAt).toBeNull();
  });

  it('completes a schedule when the next run passes endAt', async () => {
    const { service, clock } = makeService();
    const schedule = await createDaily(service, { endAt: '2026-09-29T00:00:00.000Z' });

    clock.current = new Date('2026-09-29T00:00:00.000Z');
    const result = await service.runDue(clock.current);

    expect(result.ok && result.value.completedScheduleIds).toEqual([schedule.id]);
    const refreshed = await service.getSchedule('tenant-1', schedule.id);
    expect(refreshed.ok && refreshed.value.status).toBe('completed');
  });

  it('does nothing when no schedule is due', async () => {
    const { service } = makeService();
    await createDaily(service);
    const result = await service.runDue(NOW);
    expect(result.ok && result.value.processed).toBe(0);
  });

  it('emits a failure event when invoice persistence fails', async () => {
    const publisher = new CapturingPublisher();
    const failingInvoiceRepo: RecurringInvoiceRepository = {
      createInvoice: () => Promise.reject(new Error('db down')),
      listBySchedule: async () => [] as RecurringInvoice[],
    };
    const { service, clock } = makeService({ publisher, invoiceRepository: failingInvoiceRepo });
    const schedule = await createDaily(service);

    clock.current = new Date('2026-09-29T00:00:00.000Z');
    const result = await service.runDue(clock.current);

    expect(result.ok && result.value.invoices).toHaveLength(0);
    expect(publisher.events.map((event) => event.type)).toContain('recurring_invoice.failed');
    // The schedule is left untouched so the run can be retried.
    const refreshed = await service.getSchedule('tenant-1', schedule.id);
    expect(refreshed.ok && refreshed.value.nextRunAt).toBe('2026-09-29T00:00:00.000Z');
  });
});
