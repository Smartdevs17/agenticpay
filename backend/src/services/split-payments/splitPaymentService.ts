/**
 * splitPaymentService.ts — Issue #917: Split payments between multiple
 * recipients
 *
 * Coordinates split-plan lifecycle and payment execution. All validation and
 * money maths lives in `allocation.ts`; this class only sequences state
 * transitions and persistence so it stays easy to test with a stubbed store.
 */
import { randomUUID } from 'node:crypto';

import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import {
  DEFAULT_SPLIT_CONFIG,
  allocateSplit,
  roundCurrency,
  validateSplitPlan,
} from './allocation.js';
import {
  InMemorySplitStore,
  type SplitExecutionRepository,
  type SplitPlanRepository,
} from './store.js';
import type {
  CreateSplitPlanInput,
  SplitAllocation,
  SplitConfig,
  SplitEvent,
  SplitEventPublisher,
  SplitExecution,
  SplitExecutionSummary,
  SplitPlan,
  SplitPlanFilter,
} from './types.js';

export interface SplitPaymentServiceOptions {
  repository?: SplitPlanRepository;
  executionRepository?: SplitExecutionRepository;
  config?: SplitConfig;
  publisher?: SplitEventPublisher;
  now?: () => Date;
  idFactory?: () => string;
}

export interface ExecuteSplitInput {
  paymentId: string;
  totalAmount: number;
  currency?: string;
}

/** Default publisher that logs; swap for an event-bus adapter in production. */
class LoggingSplitEventPublisher implements SplitEventPublisher {
  publish(event: SplitEvent): void {
    console.info('[split-payments] event', event.type, event.planId);
  }
}

export class SplitPaymentService extends BaseService {
  private readonly repository: SplitPlanRepository;
  private readonly executionRepository: SplitExecutionRepository;
  private readonly config: SplitConfig;
  private readonly publisher: SplitEventPublisher;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: SplitPaymentServiceOptions = {}) {
    super();
    const store = new InMemorySplitStore();
    this.repository = options.repository ?? store;
    this.executionRepository = options.executionRepository ?? store;
    this.config = options.config ?? DEFAULT_SPLIT_CONFIG;
    this.publisher = options.publisher ?? new LoggingSplitEventPublisher();
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => randomUUID());
  }

  getConfig(): SplitConfig {
    return { ...this.config, supportedCurrencies: [...this.config.supportedCurrencies] };
  }

  /** Create a split plan. Percentages must allocate exactly 100. */
  async createPlan(input: CreateSplitPlanInput): Promise<Result<SplitPlan>> {
    const validated = validateSplitPlan(input, this.config);
    if (!validated.ok) {
      return validated;
    }
    const request = validated.value;
    const timestamp = this.now().toISOString();

    const plan: SplitPlan = {
      id: this.idFactory(),
      tenantId: request.tenantId,
      merchantId: request.merchantId ?? null,
      name: request.name ?? null,
      currency: request.currency,
      platformFeePercentage: request.platformFeePercentage,
      platformFeeBps: request.platformFeeBps,
      recipients: request.recipients,
      status: 'active',
      metadata: request.metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const saved = await this.repository.create(plan);
    await this.publisher.publish({
      type: 'split_plan.created',
      planId: saved.id,
      tenantId: saved.tenantId,
      occurredAt: timestamp,
      data: { recipientCount: saved.recipients.length },
    });
    return this.ok(saved);
  }

  async getPlan(tenantId: string, planId: string): Promise<Result<SplitPlan>> {
    const plan = await this.repository.findById(planId);
    if (!plan || plan.tenantId !== tenantId) {
      return this.notFoundFailure('Split plan', planId);
    }
    return this.ok(plan);
  }

  async listPlans(tenantId: string, filter?: SplitPlanFilter): Promise<Result<SplitPlan[]>> {
    if (!tenantId) {
      return this.validationFailure('tenantId is required');
    }
    return this.ok(await this.repository.list(tenantId, filter));
  }

  async archivePlan(tenantId: string, planId: string): Promise<Result<SplitPlan>> {
    const found = await this.getPlan(tenantId, planId);
    if (!found.ok) {
      return found;
    }
    const plan = found.value;
    if (plan.status === 'archived') {
      return this.conflictFailure('Split plan is already archived');
    }
    plan.status = 'archived';
    plan.updatedAt = this.now().toISOString();

    const saved = await this.repository.update(plan);
    await this.publisher.publish({
      type: 'split_plan.archived',
      planId: saved.id,
      tenantId: saved.tenantId,
      occurredAt: saved.updatedAt,
    });
    return this.ok(saved);
  }

  /** Preview how a given amount would be distributed — no side effects. */
  async previewAllocation(
    tenantId: string,
    planId: string,
    totalAmount: number,
  ): Promise<Result<SplitAllocation>> {
    const found = await this.getPlan(tenantId, planId);
    if (!found.ok) {
      return found;
    }
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      return this.validationFailure('totalAmount must be a positive number');
    }
    const plan = found.value;
    return this.ok(
      allocateSplit({
        totalAmount,
        platformFeePercentage: plan.platformFeePercentage,
        platformFeeBps: plan.platformFeeBps,
        recipients: plan.recipients,
      }),
    );
  }

  /**
   * Execute a payment against a split plan. The allocation reconciles to the
   * payment exactly: `platformFeeAmount + Σ distributions === totalAmount`.
   */
  async executeSplit(
    tenantId: string,
    planId: string,
    input: ExecuteSplitInput,
  ): Promise<Result<SplitExecution>> {
    const found = await this.getPlan(tenantId, planId);
    if (!found.ok) {
      return found;
    }
    const plan = found.value;

    if (plan.status === 'archived') {
      return this.conflictFailure('Cannot execute an archived split plan');
    }
    if (!input.paymentId || typeof input.paymentId !== 'string') {
      return this.validationFailure('paymentId is required');
    }
    if (!Number.isFinite(input.totalAmount) || input.totalAmount <= 0) {
      return this.validationFailure('totalAmount must be a positive number');
    }
    if (input.currency && input.currency.toUpperCase() !== plan.currency) {
      return this.validationFailure(
        `currency "${input.currency.toUpperCase()}" does not match the plan currency "${plan.currency}"`,
      );
    }

    const allocation = allocateSplit({
      totalAmount: input.totalAmount,
      platformFeePercentage: plan.platformFeePercentage,
      platformFeeBps: plan.platformFeeBps,
      recipients: plan.recipients,
    });

    const execution: SplitExecution = {
      id: this.idFactory(),
      planId: plan.id,
      tenantId: plan.tenantId,
      paymentId: input.paymentId,
      totalAmount: allocation.totalAmount,
      currency: plan.currency,
      platformFeeAmount: allocation.platformFeeAmount,
      distributions: allocation.shares,
      allocatedMinor: allocation.allocatedMinor,
      executedAt: this.now().toISOString(),
    };

    const saved = await this.executionRepository.createExecution(execution);
    await this.publisher.publish({
      type: 'split.executed',
      planId: saved.planId,
      tenantId: saved.tenantId,
      occurredAt: saved.executedAt,
      data: {
        executionId: saved.id,
        paymentId: saved.paymentId,
        totalAmount: saved.totalAmount,
        allocatedMinor: saved.allocatedMinor,
      },
    });
    return this.ok(saved);
  }

  async listExecutions(tenantId: string, planId: string): Promise<Result<SplitExecution[]>> {
    const found = await this.getPlan(tenantId, planId);
    if (!found.ok) {
      return found;
    }
    return this.ok(await this.executionRepository.listByPlan(planId));
  }

  async getExecutionSummary(tenantId: string, planId: string): Promise<Result<SplitExecutionSummary>> {
    const found = await this.getPlan(tenantId, planId);
    if (!found.ok) {
      return found;
    }
    const executions = await this.executionRepository.listByPlan(planId);
    const totalProcessed = roundCurrency(executions.reduce((sum, execution) => sum + execution.totalAmount, 0));
    const totalPlatformFees = roundCurrency(
      executions.reduce((sum, execution) => sum + execution.platformFeeAmount, 0),
    );
    const skippedDistributions = executions.reduce(
      (sum, execution) => sum + execution.distributions.filter((share) => share.skipped).length,
      0,
    );

    return this.ok({
      planId,
      executionCount: executions.length,
      totalProcessed,
      totalPlatformFees,
      skippedDistributions,
    });
  }
}

export const splitPaymentService = new SplitPaymentService();
