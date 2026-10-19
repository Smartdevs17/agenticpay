/**
 * types.ts — Issue #919: BNPL installment plans
 *
 * Domain types for Buy-Now-Pay-Later installment financing. An
 * `InstallmentPlan` is created against an order principal, optionally
 * reduced by an up-front down payment, and split into a deterministic
 * schedule of `Installment` rows.
 */

/** How often consecutive installments fall due. */
export type InstallmentFrequency = 'weekly' | 'biweekly' | 'monthly';

/** Lifecycle of a single scheduled installment. */
export type InstallmentStatus = 'scheduled' | 'due' | 'paid' | 'failed' | 'cancelled';

/** Lifecycle of the plan that owns the installments. */
export type InstallmentPlanStatus = 'active' | 'completed' | 'cancelled' | 'defaulted';

export interface Installment {
  /** 1-based position in the schedule. */
  index: number;
  /** Amount due, expressed in major currency units rounded to 2 decimals. */
  amount: number;
  /** ISO-8601 UTC timestamp the installment falls due. */
  dueAt: string;
  status: InstallmentStatus;
  paidAt?: string | null;
  /** Identifier of the settled payment attempt, when paid. */
  paymentId?: string | null;
  failureReason?: string | null;
}

export interface InstallmentPlan {
  id: string;
  tenantId: string;
  customerId?: string | null;
  merchantId?: string | null;
  currency: string;
  /** Full order value before the down payment. */
  principal: number;
  /** Up-front amount paid immediately, never financed. */
  downPayment: number;
  /** principal - downPayment. */
  financedAmount: number;
  installmentCount: number;
  frequency: InstallmentFrequency;
  status: InstallmentPlanStatus;
  installments: Installment[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInstallmentPlanInput {
  tenantId: string;
  /** Order principal in major currency units. */
  amount: number;
  currency?: string;
  installmentCount: number;
  frequency?: InstallmentFrequency;
  downPayment?: number;
  customerId?: string;
  merchantId?: string;
  /** First installment due date; defaults to "now" at call time. */
  startDate?: string | Date;
  metadata?: Record<string, unknown>;
}

export interface InstallmentScheduleEntry {
  index: number;
  amount: number;
  dueAt: string;
}

export interface BNPLConfig {
  minInstallments: number;
  maxInstallments: number;
  minFinancedAmount: number;
  maxFinancedAmount: number;
  supportedCurrencies: string[];
  supportedFrequencies: InstallmentFrequency[];
  defaultFrequency: InstallmentFrequency;
}

export interface NormalizedPlanRequest {
  tenantId: string;
  amount: number;
  currency: string;
  installmentCount: number;
  frequency: InstallmentFrequency;
  downPayment: number;
  financedAmount: number;
  startDate: Date;
  customerId?: string;
  merchantId?: string;
  metadata?: Record<string, unknown>;
}

export interface InstallmentPlanSummary {
  planId: string;
  status: InstallmentPlanStatus;
  currency: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paidCount: number;
  outstandingCount: number;
  nextDueAt: string | null;
  progressPercent: number;
}

export interface RecordInstallmentPaymentInput {
  installmentIndex: number;
  paymentId?: string;
  paidAt?: string | Date;
}

export interface InstallmentPlanListFilter {
  status?: InstallmentPlanStatus;
  customerId?: string;
  merchantId?: string;
}

/** Emitted whenever a plan or one of its installments changes state. */
export type InstallmentPlanEventType =
  | 'installment_plan.created'
  | 'installment_plan.cancelled'
  | 'installment_plan.completed'
  | 'installment.paid'
  | 'installment.failed'
  | 'installment.overdue';

export interface InstallmentPlanEvent {
  type: InstallmentPlanEventType;
  planId: string;
  tenantId: string;
  occurredAt: string;
  installmentIndex?: number;
  data?: Record<string, unknown>;
}

/** Pluggable publisher so the service can stay transport-agnostic. */
export interface InstallmentEventPublisher {
  publish(event: InstallmentPlanEvent): Promise<void> | void;
}
