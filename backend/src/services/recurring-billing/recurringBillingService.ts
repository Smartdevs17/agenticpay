/**
 * recurringBillingService.ts — Issue #918: Recurring payment schedules with
 * cron-based billing
 *
 * Coordinates schedule lifecycle and due-run invoicing. All cron/date maths
 * lives in `schedule.ts`; this class only sequences state transitions and
 * persistence so it stays easy to test with a stubbed store.
 */
import { randomUUID } from 'node:crypto';

import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import {
  DEFAULT_RECURRING_BILLING_CONFIG,
  PRESET_CRONS,
  nextRunAfter,
  upcomingRuns,
  validateRecurringSchedule,
} from './schedule.js';
import {
  InMemoryRecurringBillingStore,
  type RecurringInvoiceRepository,
  type RecurringScheduleRepository,
} from './store.js';
import type {
  BillingPreset,
  CreateRecurringScheduleInput,
  RecurringBillingConfig,
  RecurringBillingEvent,
  RecurringBillingPublisher,
  RecurringInvoice,
  RecurringSchedule,
  RecurringScheduleFilter,
  RunDueResult,
} from './types.js';

export interface RecurringBillingServiceOptions {
  repository?: RecurringScheduleRepository;
  invoiceRepository?: RecurringInvoiceRepository;
  config?: RecurringBillingConfig;
  publisher?: RecurringBillingPublisher;
  now?: () => Date;
  idFactory?: () => string;
}

export interface RescheduleInput {
  cronExpression?: string;
  preset?: BillingPreset;
  timezone?: string;
}

/** Default publisher that logs; swap for an event-bus adapter in production. */
class LoggingRecurringBillingPublisher implements RecurringBillingPublisher {
  publish(event: RecurringBillingEvent): void {
    console.info('[recurring-billing] event', event.type, event.scheduleId);
  }
}

export class RecurringBillingService extends BaseService {
  private readonly repository: RecurringScheduleRepository;
  private readonly invoiceRepository: RecurringInvoiceRepository;
  private readonly config: RecurringBillingConfig;
  private readonly publisher: RecurringBillingPublisher;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: RecurringBillingServiceOptions = {}) {
    super();
    const store = new InMemoryRecurringBillingStore();
    this.repository = options.repository ?? store;
    this.invoiceRepository = options.invoiceRepository ?? store;
    this.config = options.config ?? DEFAULT_RECURRING_BILLING_CONFIG;
    this.publisher = options.publisher ?? new LoggingRecurringBillingPublisher();
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => randomUUID());
  }

  getConfig(): RecurringBillingConfig {
    return { ...this.config, supportedCurrencies: [...this.config.supportedCurrencies] };
  }

  /** Create a schedule and compute its first billing instant. */
  async createSchedule(input: CreateRecurringScheduleInput): Promise<Result<RecurringSchedule>> {
    const validated = validateRecurringSchedule(input, this.config);
    if (!validated.ok) {
      return validated;
    }

    const request = validated.value;
    const now = this.now();
    const timestamp = now.toISOString();

    // The schedule starts at max(startAt, now): a past start date must not
    // backfill, a future one delays the first invoice.
    const effectiveFrom = request.startAt.getTime() > now.getTime() ? request.startAt : now;
    // Inclusive of `effectiveFrom` itself when it lands exactly on a tick.
    const first = nextRunAfter(
      request.cronExpression,
      request.timezone,
      new Date(effectiveFrom.getTime() - 1),
    );

    const withinEnd = first != null && (request.endAt == null || first.getTime() <= request.endAt.getTime());
    const nextRunAt = withinEnd && first ? first.toISOString() : null;

    const schedule: RecurringSchedule = {
      id: this.idFactory(),
      tenantId: request.tenantId,
      customerId: request.customerId,
      merchantId: request.merchantId ?? null,
      name: request.name ?? null,
      cronExpression: request.cronExpression,
      timezone: request.timezone,
      amount: request.amount,
      currency: request.currency,
      status: nextRunAt ? 'active' : 'completed',
      startAt: request.startAt.toISOString(),
      endAt: request.endAt ? request.endAt.toISOString() : null,
      maxRuns: request.maxRuns,
      runCount: 0,
      lastRunAt: null,
      nextRunAt,
      metadata: request.metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const saved = await this.repository.create(schedule);
    await this.publisher.publish({
      type: 'recurring_schedule.created',
      scheduleId: saved.id,
      tenantId: saved.tenantId,
      occurredAt: timestamp,
      data: { cronExpression: saved.cronExpression, nextRunAt: saved.nextRunAt },
    });
    return this.ok(saved);
  }

  async getSchedule(tenantId: string, scheduleId: string): Promise<Result<RecurringSchedule>> {
    const schedule = await this.repository.findById(scheduleId);
    if (!schedule || schedule.tenantId !== tenantId) {
      return this.notFoundFailure('Recurring schedule', scheduleId);
    }
    return this.ok(schedule);
  }

  async listSchedules(
    tenantId: string,
    filter?: RecurringScheduleFilter,
  ): Promise<Result<RecurringSchedule[]>> {
    if (!tenantId) {
      return this.validationFailure('tenantId is required');
    }
    return this.ok(await this.repository.list(tenantId, filter));
  }

  /** Preview the next `count` billing instants without mutating the schedule. */
  async previewUpcoming(
    tenantId: string,
    scheduleId: string,
    count = 5,
  ): Promise<Result<{ runs: string[] }>> {
    const found = await this.getSchedule(tenantId, scheduleId);
    if (!found.ok) {
      return found;
    }
    const bounded = Math.min(Math.max(1, count), this.config.maxUpcomingPreview);
    const schedule = found.value;
    const from = schedule.nextRunAt ? new Date(new Date(schedule.nextRunAt).getTime() - 1) : this.now();
    const runs = upcomingRuns(schedule.cronExpression, schedule.timezone, bounded, from).map((date) =>
      date.toISOString(),
    );
    return this.ok({ runs });
  }

  async pauseSchedule(tenantId: string, scheduleId: string): Promise<Result<RecurringSchedule>> {
    const found = await this.getSchedule(tenantId, scheduleId);
    if (!found.ok) {
      return found;
    }
    const schedule = found.value;
    if (schedule.status !== 'active') {
      return this.conflictFailure(`Cannot pause a ${schedule.status} schedule`);
    }
    schedule.status = 'paused';
    schedule.updatedAt = this.now().toISOString();
    const saved = await this.repository.update(schedule);
    await this.publisher.publish({
      type: 'recurring_schedule.paused',
      scheduleId: saved.id,
      tenantId: saved.tenantId,
      occurredAt: saved.updatedAt,
    });
    return this.ok(saved);
  }

  async resumeSchedule(tenantId: string, scheduleId: string): Promise<Result<RecurringSchedule>> {
    const found = await this.getSchedule(tenantId, scheduleId);
    if (!found.ok) {
      return found;
    }
    const schedule = found.value;
    if (schedule.status !== 'paused') {
      return this.conflictFailure(`Cannot resume a ${schedule.status} schedule`);
    }

    const now = this.now();
    const next = nextRunAfter(schedule.cronExpression, schedule.timezone, now);
    const withinEnd =
      next != null && (schedule.endAt == null || next.getTime() <= new Date(schedule.endAt).getTime());
    const runsExhausted = schedule.maxRuns != null && schedule.runCount >= schedule.maxRuns;

    schedule.status = withinEnd && !runsExhausted ? 'active' : 'completed';
    schedule.nextRunAt = schedule.status === 'active' && next ? next.toISOString() : null;
    schedule.updatedAt = now.toISOString();

    const saved = await this.repository.update(schedule);
    await this.publisher.publish({
      type: 'recurring_schedule.resumed',
      scheduleId: saved.id,
      tenantId: saved.tenantId,
      occurredAt: saved.updatedAt,
      data: { nextRunAt: saved.nextRunAt },
    });
    return this.ok(saved);
  }

  async cancelSchedule(
    tenantId: string,
    scheduleId: string,
    reason?: string,
  ): Promise<Result<RecurringSchedule>> {
    const found = await this.getSchedule(tenantId, scheduleId);
    if (!found.ok) {
      return found;
    }
    const schedule = found.value;
    if (schedule.status === 'cancelled') {
      return this.conflictFailure('Schedule is already cancelled');
    }
    if (schedule.status === 'completed') {
      return this.conflictFailure('Cannot cancel a completed schedule');
    }

    schedule.status = 'cancelled';
    schedule.nextRunAt = null;
    schedule.updatedAt = this.now().toISOString();

    const saved = await this.repository.update(schedule);
    await this.publisher.publish({
      type: 'recurring_schedule.cancelled',
      scheduleId: saved.id,
      tenantId: saved.tenantId,
      occurredAt: saved.updatedAt,
      data: { reason: reason ?? null },
    });
    return this.ok(saved);
  }

  /** Change the cadence of an existing schedule and recompute its next run. */
  async reschedule(
    tenantId: string,
    scheduleId: string,
    input: RescheduleInput,
  ): Promise<Result<RecurringSchedule>> {
    const found = await this.getSchedule(tenantId, scheduleId);
    if (!found.ok) {
      return found;
    }
    const schedule = found.value;
    if (schedule.status === 'cancelled') {
      return this.conflictFailure('Cannot reschedule a cancelled schedule');
    }

    const effectiveCron = input.cronExpression ?? (input.preset ? PRESET_CRONS[input.preset] : schedule.cronExpression);

    const validated = validateRecurringSchedule(
      {
        tenantId: schedule.tenantId,
        customerId: schedule.customerId,
        amount: schedule.amount,
        currency: schedule.currency,
        cronExpression: effectiveCron,
        timezone: input.timezone ?? schedule.timezone,
        startAt: schedule.startAt,
        endAt: schedule.endAt ?? undefined,
        maxRuns: schedule.maxRuns ?? undefined,
        merchantId: schedule.merchantId ?? undefined,
        name: schedule.name ?? undefined,
        metadata: schedule.metadata,
      },
      this.config,
    );
    if (!validated.ok) {
      return validated;
    }

    const request = validated.value;
    const now = this.now();
    const next = nextRunAfter(request.cronExpression, request.timezone, now);
    const withinEnd =
      next != null && (request.endAt == null || next.getTime() <= request.endAt.getTime());
    const runsExhausted = schedule.maxRuns != null && schedule.runCount >= schedule.maxRuns;

    schedule.cronExpression = request.cronExpression;
    schedule.timezone = request.timezone;
    schedule.status = withinEnd && !runsExhausted ? 'active' : 'completed';
    schedule.nextRunAt = schedule.status === 'active' && next ? next.toISOString() : null;
    schedule.updatedAt = now.toISOString();

    const saved = await this.repository.update(schedule);
    await this.publisher.publish({
      type: 'recurring_schedule.rescheduled',
      scheduleId: saved.id,
      tenantId: saved.tenantId,
      occurredAt: saved.updatedAt,
      data: { cronExpression: saved.cronExpression, nextRunAt: saved.nextRunAt },
    });
    return this.ok(saved);
  }

  /**
   * Generate invoices for every active schedule whose next run is due.
   * One invoice is produced per due schedule per call; a schedule that is
   * behind catch up on subsequent sweeps.
   */
  async runDue(at: Date | string = new Date()): Promise<Result<RunDueResult>> {
    const now = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(now.getTime())) {
      return this.validationFailure('runDue timestamp must be a valid date');
    }

    const due = await this.repository.findDue(undefined, now);
    const invoices: RecurringInvoice[] = [];
    const completedScheduleIds: string[] = [];

    for (const schedule of due) {
      if (!schedule.nextRunAt) {
        continue;
      }
      const dueAt = new Date(schedule.nextRunAt);

      const invoice: RecurringInvoice = {
        id: this.idFactory(),
        scheduleId: schedule.id,
        tenantId: schedule.tenantId,
        amount: schedule.amount,
        currency: schedule.currency,
        status: 'pending',
        periodStart: schedule.lastRunAt ?? schedule.createdAt,
        dueAt: dueAt.toISOString(),
        createdAt: now.toISOString(),
      };

      try {
        await this.invoiceRepository.createInvoice(invoice);
      } catch (error) {
        await this.publisher.publish({
          type: 'recurring_invoice.failed',
          scheduleId: schedule.id,
          tenantId: schedule.tenantId,
          occurredAt: now.toISOString(),
          data: { dueAt: invoice.dueAt, error: error instanceof Error ? error.message : String(error) },
        });
        continue;
      }

      invoices.push(invoice);
      schedule.runCount += 1;
      schedule.lastRunAt = dueAt.toISOString();

      const next = nextRunAfter(schedule.cronExpression, schedule.timezone, dueAt);
      const runsExhausted = schedule.maxRuns != null && schedule.runCount >= schedule.maxRuns;
      const pastEnd =
        next == null || (schedule.endAt != null && next.getTime() > new Date(schedule.endAt).getTime());

      if (runsExhausted || pastEnd) {
        schedule.status = 'completed';
        schedule.nextRunAt = null;
        completedScheduleIds.push(schedule.id);
      } else {
        schedule.nextRunAt = next.toISOString();
      }
      schedule.updatedAt = now.toISOString();
      await this.repository.update(schedule);

      await this.publisher.publish({
        type: 'recurring_invoice.generated',
        scheduleId: schedule.id,
        tenantId: schedule.tenantId,
        occurredAt: now.toISOString(),
        data: { invoiceId: invoice.id, dueAt: invoice.dueAt, runCount: schedule.runCount },
      });
      if (schedule.status === 'completed') {
        await this.publisher.publish({
          type: 'recurring_schedule.completed',
          scheduleId: schedule.id,
          tenantId: schedule.tenantId,
          occurredAt: schedule.updatedAt,
          data: { runCount: schedule.runCount },
        });
      }
    }

    return this.ok({ processed: due.length, invoices, completedScheduleIds });
  }

  async listInvoices(tenantId: string, scheduleId: string): Promise<Result<RecurringInvoice[]>> {
    const found = await this.getSchedule(tenantId, scheduleId);
    if (!found.ok) {
      return found;
    }
    return this.ok(await this.invoiceRepository.listBySchedule(scheduleId));
  }
}

export const recurringBillingService = new RecurringBillingService();
