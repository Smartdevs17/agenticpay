/**
 * bnplService.ts — Issue #919: BNPL installment plans
 *
 * Coordinates plan creation, installment collection, and plan lifecycle.
 * All money math lives in `planner.ts`; this class only sequences state
 * transitions and persistence so it stays easy to test with a stubbed repo.
 */
import { randomUUID } from 'node:crypto';

import { BaseService } from '../../BaseService.js';
import type { Result } from '../../../lib/result.js';
import {
  DEFAULT_BNPL_CONFIG,
  buildInstallmentSchedule,
  nextActionableInstallment,
  roundCurrency,
  summarizePlan,
  validateInstallmentRequest,
} from './planner.js';
import { InMemoryInstallmentPlanRepository, type InstallmentPlanRepository } from './store.js';
import type {
  BNPLConfig,
  CreateInstallmentPlanInput,
  Installment,
  InstallmentEventPublisher,
  InstallmentPlan,
  InstallmentPlanEvent,
  InstallmentPlanListFilter,
  InstallmentPlanSummary,
  RecordInstallmentPaymentInput,
} from './types.js';

export interface BNPLServiceOptions {
  repository?: InstallmentPlanRepository;
  config?: BNPLConfig;
  publisher?: InstallmentEventPublisher;
  now?: () => Date;
  idFactory?: () => string;
}

/** Default publisher that simply logs; swap for an event-bus adapter in prod. */
class LoggingInstallmentEventPublisher implements InstallmentEventPublisher {
  publish(event: InstallmentPlanEvent): void {
    console.info('[bnpl] event', event.type, event.planId, event.installmentIndex ?? '');
  }
}

export class BNPLInstallmentService extends BaseService {
  private readonly repository: InstallmentPlanRepository;
  private readonly config: BNPLConfig;
  private readonly publisher: InstallmentEventPublisher;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: BNPLServiceOptions = {}) {
    super();
    this.repository = options.repository ?? new InMemoryInstallmentPlanRepository();
    this.config = options.config ?? DEFAULT_BNPL_CONFIG;
    this.publisher = options.publisher ?? new LoggingInstallmentEventPublisher();
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => randomUUID());
  }

  getConfig(): BNPLConfig {
    return { ...this.config, supportedCurrencies: [...this.config.supportedCurrencies] };
  }

  /**
   * Create a financed plan and persist its derived schedule. A down payment
   * (when supplied) is recorded on the plan but is not part of the financed
   * schedule — the customer settles it outside the plan.
   */
  async createPlan(input: CreateInstallmentPlanInput): Promise<Result<InstallmentPlan>> {
    const validated = validateInstallmentRequest(input, this.config);
    if (!validated.ok) {
      return validated;
    }

    const request = validated.value;
    const schedule = buildInstallmentSchedule({
      financedAmount: request.financedAmount,
      installmentCount: request.installmentCount,
      frequency: request.frequency,
      startDate: request.startDate,
    });

    const timestamp = this.now().toISOString();
    const installments: Installment[] = schedule.map((entry) => ({
      index: entry.index,
      amount: entry.amount,
      dueAt: entry.dueAt,
      status: 'scheduled',
      paidAt: null,
      paymentId: null,
      failureReason: null,
    }));

    const plan: InstallmentPlan = {
      id: this.idFactory(),
      tenantId: request.tenantId,
      customerId: request.customerId ?? null,
      merchantId: request.merchantId ?? null,
      currency: request.currency,
      principal: request.amount,
      downPayment: request.downPayment,
      financedAmount: request.financedAmount,
      installmentCount: request.installmentCount,
      frequency: request.frequency,
      status: 'active',
      installments,
      metadata: request.metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // Guard against a schedule that fails to reconcile with the financed amount.
    const scheduledTotal = roundCurrency(
      installments.reduce((sum, installment) => sum + installment.amount, 0),
    );
    if (scheduledTotal !== request.financedAmount) {
      return this.unexpectedFailure(
        new Error(
          `Installment schedule does not reconcile: expected ${request.financedAmount}, got ${scheduledTotal}`,
        ),
      );
    }

    const saved = await this.repository.create(plan);
    await this.publisher.publish({
      type: 'installment_plan.created',
      planId: saved.id,
      tenantId: saved.tenantId,
      occurredAt: timestamp,
      data: { financedAmount: saved.financedAmount, installmentCount: saved.installmentCount },
    });
    return this.ok(saved);
  }

  async getPlan(tenantId: string, planId: string): Promise<Result<InstallmentPlan>> {
    const plan = await this.repository.findById(planId);
    if (!plan || plan.tenantId !== tenantId) {
      return this.notFoundFailure('Installment plan', planId);
    }
    return this.ok(plan);
  }

  async listPlans(
    tenantId: string,
    filter?: InstallmentPlanListFilter,
  ): Promise<Result<InstallmentPlan[]>> {
    if (!tenantId) {
      return this.validationFailure('tenantId is required');
    }
    return this.ok(await this.repository.list(tenantId, filter));
  }

  async getSummary(tenantId: string, planId: string): Promise<Result<InstallmentPlanSummary>> {
    const found = await this.getPlan(tenantId, planId);
    if (!found.ok) {
      return found;
    }
    return this.ok(summarizePlan(found.value));
  }

  /** Record a successful collection for one installment. */
  async payInstallment(
    tenantId: string,
    planId: string,
    input: RecordInstallmentPaymentInput,
  ): Promise<Result<InstallmentPlan>> {
    const found = await this.getPlan(tenantId, planId);
    if (!found.ok) {
      return found;
    }
    const plan = found.value;

    if (plan.status === 'cancelled') {
      return this.conflictFailure('Cannot collect an installment on a cancelled plan');
    }
    if (plan.status === 'completed') {
      return this.conflictFailure('Plan is already fully paid');
    }

    const target = plan.installments.find((installment) => installment.index === input.installmentIndex);
    if (!target) {
      return this.validationFailure(`No installment at index ${input.installmentIndex}`);
    }
    if (target.status === 'paid') {
      return this.conflictFailure(`Installment ${input.installmentIndex} has already been paid`);
    }
    if (target.status === 'cancelled') {
      return this.conflictFailure(`Installment ${input.installmentIndex} has been cancelled`);
    }

    const paidAt = input.paidAt ? new Date(input.paidAt) : this.now();
    if (Number.isNaN(paidAt.getTime())) {
      return this.validationFailure('paidAt must be a valid date');
    }

    target.status = 'paid';
    target.paidAt = paidAt.toISOString();
    target.paymentId = input.paymentId ?? null;
    target.failureReason = null;

    const allPaid = plan.installments.every((installment) => installment.status === 'paid');
    plan.status = allPaid ? 'completed' : plan.status;
    plan.updatedAt = this.now().toISOString();

    const saved = await this.repository.update(plan);
    await this.publisher.publish({
      type: 'installment.paid',
      planId: saved.id,
      tenantId: saved.tenantId,
      occurredAt: saved.updatedAt,
      installmentIndex: target.index,
      data: { amount: target.amount, paymentId: target.paymentId },
    });
    if (allPaid) {
      await this.publisher.publish({
        type: 'installment_plan.completed',
        planId: saved.id,
        tenantId: saved.tenantId,
        occurredAt: saved.updatedAt,
      });
    }
    return this.ok(saved);
  }

  /** Mark an installment collection as failed so retries can target it. */
  async markInstallmentFailed(
    tenantId: string,
    planId: string,
    installmentIndex: number,
    reason: string,
  ): Promise<Result<InstallmentPlan>> {
    const found = await this.getPlan(tenantId, planId);
    if (!found.ok) {
      return found;
    }
    const plan = found.value;

    if (plan.status === 'cancelled' || plan.status === 'completed') {
      return this.conflictFailure(`Cannot fail an installment on a ${plan.status} plan`);
    }

    const target = plan.installments.find((installment) => installment.index === installmentIndex);
    if (!target) {
      return this.validationFailure(`No installment at index ${installmentIndex}`);
    }
    if (target.status === 'paid') {
      return this.conflictFailure(`Installment ${installmentIndex} is already paid`);
    }

    target.status = 'failed';
    target.failureReason = reason;
    plan.updatedAt = this.now().toISOString();

    const saved = await this.repository.update(plan);
    await this.publisher.publish({
      type: 'installment.failed',
      planId: saved.id,
      tenantId: saved.tenantId,
      occurredAt: saved.updatedAt,
      installmentIndex: target.index,
      data: { reason },
    });
    return this.ok(saved);
  }

  /** Cancel a plan, voiding every still-outstanding installment. */
  async cancelPlan(tenantId: string, planId: string, reason?: string): Promise<Result<InstallmentPlan>> {
    const found = await this.getPlan(tenantId, planId);
    if (!found.ok) {
      return found;
    }
    const plan = found.value;

    if (plan.status === 'completed') {
      return this.conflictFailure('Cannot cancel a completed plan');
    }
    if (plan.status === 'cancelled') {
      return this.conflictFailure('Plan is already cancelled');
    }

    for (const installment of plan.installments) {
      if (installment.status === 'scheduled' || installment.status === 'due' || installment.status === 'failed') {
        installment.status = 'cancelled';
      }
    }
    plan.status = 'cancelled';
    plan.updatedAt = this.now().toISOString();

    const saved = await this.repository.update(plan);
    await this.publisher.publish({
      type: 'installment_plan.cancelled',
      planId: saved.id,
      tenantId: saved.tenantId,
      occurredAt: saved.updatedAt,
      data: { reason: reason ?? null },
    });
    return this.ok(saved);
  }

  /**
   * Flag outstanding installments whose due date has passed. Idempotent:
   * re-running only rewrites installments that are still `scheduled`.
   */
  async sweepOverdue(
    tenantId: string,
    at: Date | string = new Date(),
  ): Promise<Result<{ scanned: number; flagged: number }>> {
    const reference = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(reference.getTime())) {
      return this.validationFailure('sweep timestamp must be a valid date');
    }

    const plans = await this.repository.findWithOverdueInstallments(tenantId, reference);
    let flagged = 0;

    for (const plan of plans) {
      let mutated = false;
      for (const installment of plan.installments) {
        if (installment.status === 'scheduled' && new Date(installment.dueAt).getTime() < reference.getTime()) {
          installment.status = 'due';
          mutated = true;
          flagged += 1;
        }
      }
      if (!mutated) {
        continue;
      }
      plan.updatedAt = this.now().toISOString();
      await this.repository.update(plan);
      const next = nextActionableInstallment(plan);
      await this.publisher.publish({
        type: 'installment.overdue',
        planId: plan.id,
        tenantId: plan.tenantId,
        occurredAt: plan.updatedAt,
        installmentIndex: next?.index,
        data: { dueAt: next?.dueAt ?? null },
      });
    }

    return this.ok({ scanned: plans.length, flagged });
  }
}

export const bnplInstallmentService = new BNPLInstallmentService();
