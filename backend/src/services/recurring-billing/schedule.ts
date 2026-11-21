/**
 * schedule.ts — Issue #918: Recurring payment schedules with cron-based billing
 *
 * Pure, side-effect-free helpers that validate a recurring-schedule request and
 * resolve its cron cadence. All date maths lives here so it is directly
 * unit-testable and excluded from clock/IO concerns.
 */
import cronParser from 'cron-parser';

import { err, ok, type Result } from '../../lib/result.js';
import type {
  BillingPreset,
  CreateRecurringScheduleInput,
  NormalizedRecurringSchedule,
  RecurringBillingConfig,
} from './types.js';

export const DEFAULT_RECURRING_BILLING_CONFIG: RecurringBillingConfig = {
  supportedCurrencies: ['USD', 'EUR', 'GBP', 'XLM', 'USDC'],
  minAmount: 0.01,
  maxAmount: 1_000_000,
  defaultCurrency: 'USD',
  defaultTimezone: 'UTC',
  defaultPreset: 'monthly',
  maxUpcomingPreview: 50,
};

/** Canonical cron expressions for the supported presets. */
export const PRESET_CRONS: Record<BillingPreset, string> = {
  hourly: '0 * * * *',
  daily: '0 0 * * *',
  weekly: '0 0 * * 0',
  monthly: '0 0 1 * *',
  yearly: '0 0 1 1 *',
};

/** Round to 2 decimals using a half-up rule that tolerates float error. */
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** True when `expression` is a cron string cron-parser can evaluate. */
export function isValidCronExpression(expression: string, timezone = 'UTC'): boolean {
  if (!expression || typeof expression !== 'string') {
    return false;
  }
  try {
    cronParser.parseExpression(expression, { tz: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * True when `timezone` is a valid IANA zone. Validated through `Intl` because
 * cron-parser silently accepts unknown zones instead of rejecting them.
 */
export function isValidTimezone(timezone: string): boolean {
  if (!timezone || typeof timezone !== 'string') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * First cron occurrence strictly after `after`. Returns null when the
 * expression/timezone cannot be evaluated.
 */
export function nextRunAfter(cronExpression: string, timezone: string, after: Date): Date | null {
  try {
    const interval = cronParser.parseExpression(cronExpression, { tz: timezone, currentDate: after });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

/** The next `count` occurrences strictly after `after`. */
export function upcomingRuns(
  cronExpression: string,
  timezone: string,
  count: number,
  after: Date,
): Date[] {
  const runs: Date[] = [];
  if (count <= 0) {
    return runs;
  }
  try {
    const interval = cronParser.parseExpression(cronExpression, { tz: timezone, currentDate: after });
    for (let i = 0; i < count; i += 1) {
      runs.push(interval.next().toDate());
    }
  } catch {
    return [];
  }
  return runs;
}

/** Resolve the effective cron expression for a request (raw cron wins). */
export function resolveCronExpression(input: Pick<CreateRecurringScheduleInput, 'cronExpression' | 'preset'>, config = DEFAULT_RECURRING_BILLING_CONFIG): string {
  if (input.cronExpression) {
    return input.cronExpression.trim();
  }
  return PRESET_CRONS[input.preset ?? config.defaultPreset];
}

/**
 * Validate and normalise a create request. Returns a `Result` so callers can
 * surface a precise 400 instead of throwing deep inside the service.
 */
export function validateRecurringSchedule(
  input: CreateRecurringScheduleInput,
  config: RecurringBillingConfig = DEFAULT_RECURRING_BILLING_CONFIG,
): Result<NormalizedRecurringSchedule> {
  if (!input || typeof input !== 'object') {
    return err({ code: 'VALIDATION_ERROR', message: 'Schedule request body is required', statusCode: 400 });
  }

  if (!input.tenantId || typeof input.tenantId !== 'string') {
    return err({ code: 'VALIDATION_ERROR', message: 'tenantId is required', statusCode: 400 });
  }
  if (!input.customerId || typeof input.customerId !== 'string') {
    return err({ code: 'VALIDATION_ERROR', message: 'customerId is required', statusCode: 400 });
  }

  const amount = roundCurrency(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return err({ code: 'VALIDATION_ERROR', message: 'amount must be a positive number', statusCode: 400 });
  }
  if (amount < config.minAmount) {
    return err({ code: 'VALIDATION_ERROR', message: `amount must be at least ${config.minAmount}`, statusCode: 400 });
  }
  if (amount > config.maxAmount) {
    return err({ code: 'VALIDATION_ERROR', message: `amount must not exceed ${config.maxAmount}`, statusCode: 400 });
  }

  const currency = (input.currency ?? config.defaultCurrency).toUpperCase();
  if (!config.supportedCurrencies.includes(currency)) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `currency must be one of: ${config.supportedCurrencies.join(', ')}`,
      statusCode: 400,
    });
  }

  const cronExpression = resolveCronExpression(input, config);
  const timezone = input.timezone ?? config.defaultTimezone;
  if (!isValidTimezone(timezone)) {
    return err({ code: 'VALIDATION_ERROR', message: `timezone "${timezone}" is not a valid IANA zone`, statusCode: 400 });
  }
  if (!isValidCronExpression(cronExpression, timezone)) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `cronExpression "${cronExpression}" is invalid${input.cronExpression ? '' : ` for preset "${input.preset ?? config.defaultPreset}"`}`,
      statusCode: 400,
    });
  }

  const startAt = input.startAt ? new Date(input.startAt) : new Date();
  if (Number.isNaN(startAt.getTime())) {
    return err({ code: 'VALIDATION_ERROR', message: 'startAt must be a valid date', statusCode: 400 });
  }

  let endAt: Date | null = null;
  if (input.endAt != null) {
    endAt = new Date(input.endAt);
    if (Number.isNaN(endAt.getTime())) {
      return err({ code: 'VALIDATION_ERROR', message: 'endAt must be a valid date', statusCode: 400 });
    }
    if (endAt.getTime() < startAt.getTime()) {
      return err({ code: 'VALIDATION_ERROR', message: 'endAt must be on or after startAt', statusCode: 400 });
    }
  }

  let maxRuns: number | null = null;
  if (input.maxRuns != null) {
    if (!Number.isInteger(input.maxRuns) || input.maxRuns < 1) {
      return err({ code: 'VALIDATION_ERROR', message: 'maxRuns must be a positive integer', statusCode: 400 });
    }
    maxRuns = input.maxRuns;
  }

  return ok({
    tenantId: input.tenantId,
    customerId: input.customerId,
    amount,
    currency,
    cronExpression,
    timezone,
    startAt,
    endAt,
    maxRuns,
    merchantId: input.merchantId,
    name: input.name,
    metadata: input.metadata,
  });
}
