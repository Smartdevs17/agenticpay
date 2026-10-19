/**
 * store.ts — Issue #918: Recurring payment schedules with cron-based billing
 *
 * Persistence boundary for recurring schedules and their generated invoices.
 * The service depends on these interfaces, so production can back them with
 * Prisma while tests use the deterministic in-memory implementation below.
 */
import type { RecurringInvoice, RecurringSchedule, RecurringScheduleFilter } from './types.js';

export interface RecurringScheduleRepository {
  create(schedule: RecurringSchedule): Promise<RecurringSchedule>;
  findById(id: string): Promise<RecurringSchedule | null>;
  update(schedule: RecurringSchedule): Promise<RecurringSchedule>;
  list(tenantId: string, filter?: RecurringScheduleFilter): Promise<RecurringSchedule[]>;
  /**
   * Active schedules whose `nextRunAt` is at or before `before`. When
   * `tenantId` is omitted all tenants are scanned (used by the billing sweep).
   */
  findDue(tenantId: string | undefined, before: Date): Promise<RecurringSchedule[]>;
}

export interface RecurringInvoiceRepository {
  /** Named distinctly from the schedule `create` so one class can back both. */
  createInvoice(invoice: RecurringInvoice): Promise<RecurringInvoice>;
  listBySchedule(scheduleId: string): Promise<RecurringInvoice[]>;
}

function cloneSchedule(schedule: RecurringSchedule): RecurringSchedule {
  return {
    ...schedule,
    metadata: schedule.metadata ? { ...schedule.metadata } : schedule.metadata,
  };
}

export class InMemoryRecurringBillingStore
  implements RecurringScheduleRepository, RecurringInvoiceRepository
{
  private readonly schedules = new Map<string, RecurringSchedule>();
  private readonly invoices = new Map<string, RecurringInvoice[]>();

  async create(schedule: RecurringSchedule): Promise<RecurringSchedule> {
    const stored = cloneSchedule(schedule);
    this.schedules.set(stored.id, stored);
    if (!this.invoices.has(stored.id)) {
      this.invoices.set(stored.id, []);
    }
    return cloneSchedule(stored);
  }

  async findById(id: string): Promise<RecurringSchedule | null> {
    const found = this.schedules.get(id);
    return found ? cloneSchedule(found) : null;
  }

  async update(schedule: RecurringSchedule): Promise<RecurringSchedule> {
    const stored = cloneSchedule(schedule);
    this.schedules.set(stored.id, stored);
    return cloneSchedule(stored);
  }

  async list(tenantId: string, filter?: RecurringScheduleFilter): Promise<RecurringSchedule[]> {
    return Array.from(this.schedules.values())
      .filter((schedule) => schedule.tenantId === tenantId)
      .filter((schedule) => (filter?.status ? schedule.status === filter.status : true))
      .filter((schedule) => (filter?.customerId ? schedule.customerId === filter.customerId : true))
      .filter((schedule) => (filter?.merchantId ? schedule.merchantId === filter.merchantId : true))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(cloneSchedule);
  }

  async findDue(tenantId: string | undefined, before: Date): Promise<RecurringSchedule[]> {
    const cutoff = before.getTime();
    return Array.from(this.schedules.values())
      .filter((schedule) => (tenantId ? schedule.tenantId === tenantId : true))
      .filter((schedule) => schedule.status === 'active')
      .filter((schedule) => schedule.nextRunAt != null && new Date(schedule.nextRunAt).getTime() <= cutoff)
      .sort((a, b) => (a.nextRunAt ?? '').localeCompare(b.nextRunAt ?? '') || a.id.localeCompare(b.id))
      .map(cloneSchedule);
  }

  async createInvoice(invoice: RecurringInvoice): Promise<RecurringInvoice> {
    const existing = this.invoices.get(invoice.scheduleId) ?? [];
    const stored = { ...invoice };
    existing.push(stored);
    this.invoices.set(invoice.scheduleId, existing);
    return { ...stored };
  }

  async listBySchedule(scheduleId: string): Promise<RecurringInvoice[]> {
    return (this.invoices.get(scheduleId) ?? []).map((invoice) => ({ ...invoice }));
  }

  /** Test/introspection helper: every invoice across all schedules. */
  allInvoices(): RecurringInvoice[] {
    return Array.from(this.invoices.values()).flatMap((list) => list.map((invoice) => ({ ...invoice })));
  }
}
