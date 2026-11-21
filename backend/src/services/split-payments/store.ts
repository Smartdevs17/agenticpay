/**
 * store.ts — Issue #917: Split payments between multiple recipients
 *
 * Persistence boundary for split plans and their executions. The service
 * depends on these interfaces, so production can back them with Prisma while
 * tests use the deterministic in-memory implementation below.
 */
import type { SplitExecution, SplitPlan, SplitPlanFilter } from './types.js';

export interface SplitPlanRepository {
  create(plan: SplitPlan): Promise<SplitPlan>;
  findById(id: string): Promise<SplitPlan | null>;
  update(plan: SplitPlan): Promise<SplitPlan>;
  list(tenantId: string, filter?: SplitPlanFilter): Promise<SplitPlan[]>;
}

export interface SplitExecutionRepository {
  createExecution(execution: SplitExecution): Promise<SplitExecution>;
  listByPlan(planId: string): Promise<SplitExecution[]>;
}

function clonePlan(plan: SplitPlan): SplitPlan {
  return {
    ...plan,
    recipients: plan.recipients.map((recipient) => ({ ...recipient })),
    metadata: plan.metadata ? { ...plan.metadata } : plan.metadata,
  };
}

function cloneExecution(execution: SplitExecution): SplitExecution {
  return {
    ...execution,
    distributions: execution.distributions.map((share) => ({ ...share })),
  };
}

export class InMemorySplitStore implements SplitPlanRepository, SplitExecutionRepository {
  private readonly plans = new Map<string, SplitPlan>();
  private readonly executions = new Map<string, SplitExecution[]>();

  async create(plan: SplitPlan): Promise<SplitPlan> {
    const stored = clonePlan(plan);
    this.plans.set(stored.id, stored);
    return clonePlan(stored);
  }

  async findById(id: string): Promise<SplitPlan | null> {
    const found = this.plans.get(id);
    return found ? clonePlan(found) : null;
  }

  async update(plan: SplitPlan): Promise<SplitPlan> {
    const stored = clonePlan(plan);
    this.plans.set(stored.id, stored);
    return clonePlan(stored);
  }

  async list(tenantId: string, filter?: SplitPlanFilter): Promise<SplitPlan[]> {
    return Array.from(this.plans.values())
      .filter((plan) => plan.tenantId === tenantId)
      .filter((plan) => (filter?.status ? plan.status === filter.status : true))
      .filter((plan) => (filter?.merchantId ? plan.merchantId === filter.merchantId : true))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(clonePlan);
  }

  async createExecution(execution: SplitExecution): Promise<SplitExecution> {
    const existing = this.executions.get(execution.planId) ?? [];
    const stored = cloneExecution(execution);
    existing.push(stored);
    this.executions.set(execution.planId, existing);
    return cloneExecution(stored);
  }

  async listByPlan(planId: string): Promise<SplitExecution[]> {
    return (this.executions.get(planId) ?? []).map(cloneExecution);
  }
}
