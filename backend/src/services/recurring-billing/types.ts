/**
 * types.ts — Issue #918: Recurring payment schedules with cron-based billing
 *
 * Domain types for billing a customer on a cron cadence. A `RecurringSchedule`
 * describes *who* is billed *how much* and *when* (a cron expression plus an
 * IANA timezone); each due run materialises a `RecurringInvoice`.
 */

/** Convenience presets that expand to a canonical cron expression. */
export type BillingPreset = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Lifecycle of a recurring schedule. */
export type RecurringScheduleStatus = 'active' | 'paused' | 'cancelled' | 'completed';

/** Lifecycle of a generated invoice. */
export type RecurringInvoiceStatus = 'pending' | 'paid' | 'failed' | 'void';

export interface RecurringSchedule {
  id: string;
  tenantId: string;
  customerId: string;
  merchantId?: string | null;
  name?: string | null;
  /** Cron expression that defines the billing cadence. */
  cronExpression: string;
  /** IANA timezone the cron expression is evaluated in. */
  timezone: string;
  amount: number;
  currency: string;
  status: RecurringScheduleStatus;
  /** When the schedule becomes eligible to bill (ISO-8601). */
  startAt: string;
  /** Optional end boundary; no invoice is generated after this instant. */
  endAt?: string | null;
  /** Optional cap on the number of invoices generated. */
  maxRuns?: number | null;
  runCount: number;
  lastRunAt?: string | null;
  /** Next invoice instant, or null once no further runs are possible. */
  nextRunAt: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRecurringScheduleInput {
  tenantId: string;
  customerId: string;
  amount: number;
  currency?: string;
  /** Raw cron expression. Mutually exclusive with `preset`. */
  cronExpression?: string;
  /** Preset cadence. Ignored when `cronExpression` is provided. */
  preset?: BillingPreset;
  timezone?: string;
  startAt?: string | Date;
  endAt?: string | Date;
  maxRuns?: number;
  merchantId?: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizedRecurringSchedule {
  tenantId: string;
  customerId: string;
  amount: number;
  currency: string;
  cronExpression: string;
  timezone: string;
  startAt: Date;
  endAt: Date | null;
  maxRuns: number | null;
  merchantId?: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface RecurringInvoice {
  id: string;
  scheduleId: string;
  tenantId: string;
  amount: number;
  currency: string;
  status: RecurringInvoiceStatus;
  /** Start of the billed period (previous run, or schedule creation). */
  periodStart: string;
  /** When the invoice falls due (the schedule's `nextRunAt`). */
  dueAt: string;
  createdAt: string;
}

export interface RecurringScheduleFilter {
  status?: RecurringScheduleStatus;
  customerId?: string;
  merchantId?: string;
}

export interface RunDueResult {
  processed: number;
  invoices: RecurringInvoice[];
  completedScheduleIds: string[];
}

export interface RecurringBillingConfig {
  supportedCurrencies: string[];
  minAmount: number;
  maxAmount: number;
  defaultCurrency: string;
  defaultTimezone: string;
  defaultPreset: BillingPreset;
  /** Upper bound for `previewUpcoming`. */
  maxUpcomingPreview: number;
}

export type RecurringBillingEventType =
  | 'recurring_schedule.created'
  | 'recurring_schedule.paused'
  | 'recurring_schedule.resumed'
  | 'recurring_schedule.cancelled'
  | 'recurring_schedule.completed'
  | 'recurring_schedule.rescheduled'
  | 'recurring_invoice.generated'
  | 'recurring_invoice.failed';

export interface RecurringBillingEvent {
  type: RecurringBillingEventType;
  scheduleId: string;
  tenantId: string;
  occurredAt: string;
  data?: Record<string, unknown>;
}

/** Pluggable publisher so the service stays transport-agnostic. */
export interface RecurringBillingPublisher {
  publish(event: RecurringBillingEvent): Promise<void> | void;
}
