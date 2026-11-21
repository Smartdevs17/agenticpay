/**
 * planner.ts — Issue #919: BNPL installment plans
 *
 * Pure, side-effect-free helpers that validate an installment request and
 * derive a deterministic repayment schedule. Keeping the money math here
 * (rather than inside the service) makes it directly unit-testable and
 * avoids floating-point drift leaking into persisted plans.
 */
import { err, ok, type Result } from '../../../lib/result.js';
import type {
  BNPLConfig,
  CreateInstallmentPlanInput,
  Installment,
  InstallmentFrequency,
  InstallmentPlan,
  InstallmentPlanSummary,
  InstallmentScheduleEntry,
  NormalizedPlanRequest,
} from './types.js';

export const DEFAULT_BNPL_CONFIG: BNPLConfig = {
  minInstallments: 2,
  maxInstallments: 12,
  minFinancedAmount: 10,
  maxFinancedAmount: 100_000,
  supportedCurrencies: ['USD', 'EUR', 'GBP', 'XLM', 'USDC'],
  supportedFrequencies: ['weekly', 'biweekly', 'monthly'],
  defaultFrequency: 'monthly',
};

const FREQUENCY_DAYS: Record<Exclude<InstallmentFrequency, 'monthly'>, number> = {
  weekly: 7,
  biweekly: 14,
};

/** Round to 2 decimals using a half-up rule that tolerates float error. */
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Advance a date by `periods` billing periods.
 *
 * Weekly/biweekly use fixed day counts; monthly uses calendar months so the
 * day-of-month is preserved (clamped to the target month's last day, e.g.
 * Jan 31 + 1 month => Feb 28/29).
 */
export function addPeriod(
  base: Date | string,
  frequency: InstallmentFrequency,
  periods: number,
): Date {
  const date = base instanceof Date ? new Date(base.getTime()) : new Date(base);
  if (frequency === 'monthly') {
    const dayOfMonth = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + periods);
    const lastDayOfMonth = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(dayOfMonth, lastDayOfMonth));
    return date;
  }

  date.setUTCDate(date.getUTCDate() + FREQUENCY_DAYS[frequency] * periods);
  return date;
}

export interface BuildScheduleParams {
  financedAmount: number;
  installmentCount: number;
  frequency: InstallmentFrequency;
  startDate: Date | string;
}

/**
 * Split `financedAmount` into `installmentCount` installments that sum back
 * to the financed amount exactly. Each installment gets the floored
 * 2-decimal share and the final installment absorbs the remaining cents, so
 * no money is created or lost to rounding.
 */
export function buildInstallmentSchedule(params: BuildScheduleParams): InstallmentScheduleEntry[] {
  const { financedAmount, installmentCount, frequency, startDate } = params;
  if (installmentCount <= 0) {
    throw new Error('installmentCount must be greater than zero');
  }

  const financed = roundCurrency(financedAmount);
  const baseShare = Math.floor((financed / installmentCount) * 100) / 100;
  const remainder = roundCurrency(financed - roundCurrency(baseShare * installmentCount));
  const firstDue = startDate instanceof Date ? startDate : new Date(startDate);

  const schedule: InstallmentScheduleEntry[] = [];
  for (let index = 1; index <= installmentCount; index += 1) {
    const isFinal = index === installmentCount;
    schedule.push({
      index,
      amount: isFinal ? roundCurrency(baseShare + remainder) : baseShare,
      dueAt: addPeriod(firstDue, frequency, index - 1).toISOString(),
    });
  }
  return schedule;
}

/**
 * Validate and normalise a raw create request against the BNPL config.
 * Returns a `Result` so callers can surface a 400 with a precise reason
 * instead of throwing deep inside the service.
 */
export function validateInstallmentRequest(
  input: CreateInstallmentPlanInput,
  config: BNPLConfig = DEFAULT_BNPL_CONFIG,
): Result<NormalizedPlanRequest> {
  if (!input || typeof input !== 'object') {
    return err({ code: 'VALIDATION_ERROR', message: 'Plan request body is required', statusCode: 400 });
  }

  if (!input.tenantId || typeof input.tenantId !== 'string') {
    return err({ code: 'VALIDATION_ERROR', message: 'tenantId is required', statusCode: 400 });
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return err({ code: 'VALIDATION_ERROR', message: 'amount must be a positive number', statusCode: 400 });
  }

  const installmentCount = Number(input.installmentCount);
  if (!Number.isInteger(installmentCount)) {
    return err({ code: 'VALIDATION_ERROR', message: 'installmentCount must be an integer', statusCode: 400 });
  }
  if (installmentCount < config.minInstallments || installmentCount > config.maxInstallments) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `installmentCount must be between ${config.minInstallments} and ${config.maxInstallments}`,
      statusCode: 400,
    });
  }

  const frequency = input.frequency ?? config.defaultFrequency;
  if (!config.supportedFrequencies.includes(frequency)) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `frequency must be one of: ${config.supportedFrequencies.join(', ')}`,
      statusCode: 400,
    });
  }

  const currency = (input.currency ?? 'USD').toUpperCase();
  if (!config.supportedCurrencies.includes(currency)) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `currency must be one of: ${config.supportedCurrencies.join(', ')}`,
      statusCode: 400,
    });
  }

  const downPayment = input.downPayment == null ? 0 : roundCurrency(Number(input.downPayment));
  if (!Number.isFinite(downPayment) || downPayment < 0) {
    return err({ code: 'VALIDATION_ERROR', message: 'downPayment must be a non-negative number', statusCode: 400 });
  }
  if (downPayment >= amount) {
    return err({
      code: 'VALIDATION_ERROR',
      message: 'downPayment must be less than amount',
      statusCode: 400,
    });
  }

  const financedAmount = roundCurrency(amount - downPayment);
  if (financedAmount < config.minFinancedAmount) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `financed amount must be at least ${config.minFinancedAmount} ${currency}`,
      statusCode: 400,
    });
  }
  if (financedAmount > config.maxFinancedAmount) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `financed amount must not exceed ${config.maxFinancedAmount} ${currency}`,
      statusCode: 400,
    });
  }

  const startDate = input.startDate ? new Date(input.startDate) : new Date();
  if (Number.isNaN(startDate.getTime())) {
    return err({ code: 'VALIDATION_ERROR', message: 'startDate must be a valid date', statusCode: 400 });
  }

  return ok({
    tenantId: input.tenantId,
    amount: roundCurrency(amount),
    currency,
    installmentCount,
    frequency,
    downPayment,
    financedAmount,
    startDate,
    customerId: input.customerId,
    merchantId: input.merchantId,
    metadata: input.metadata,
  });
}

const OUTSTANDING_STATUSES = new Set(['scheduled', 'due']);

/** Next installment that still needs collecting, in schedule order. */
export function nextActionableInstallment(plan: InstallmentPlan): Installment | null {
  return plan.installments.find((installment) => OUTSTANDING_STATUSES.has(installment.status)) ?? null;
}

export function summarizePlan(plan: InstallmentPlan): InstallmentPlanSummary {
  const paid = plan.installments.filter((installment) => installment.status === 'paid');
  const outstanding = plan.installments.filter((installment) => OUTSTANDING_STATUSES.has(installment.status));
  const paidAmount = roundCurrency(paid.reduce((sum, installment) => sum + installment.amount, 0));
  const totalAmount = roundCurrency(
    plan.installments.reduce((sum, installment) => sum + installment.amount, 0),
  );
  const next = nextActionableInstallment(plan);

  return {
    planId: plan.id,
    status: plan.status,
    currency: plan.currency,
    totalAmount,
    paidAmount,
    remainingAmount: roundCurrency(totalAmount - paidAmount),
    paidCount: paid.length,
    outstandingCount: outstanding.length,
    nextDueAt: next ? next.dueAt : null,
    progressPercent:
      plan.installments.length === 0
        ? 0
        : roundCurrency((paid.length / plan.installments.length) * 100),
  };
}

/** True when any outstanding installment is past its due date. */
export function isPlanOverdue(plan: InstallmentPlan, now: Date | string = new Date()): boolean {
  const reference = now instanceof Date ? now : new Date(now);
  return plan.installments.some(
    (installment) =>
      OUTSTANDING_STATUSES.has(installment.status) && new Date(installment.dueAt).getTime() < reference.getTime(),
  );
}
