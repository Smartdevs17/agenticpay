/**
 * store.ts — Issue #919: BNPL installment plans
 *
 * Persistence boundary for installment plans. The service depends on the
 * `InstallmentPlanRepository` interface, so production can back it with
 * Prisma while tests use the deterministic in-memory implementation below.
 */
import type { InstallmentPlan, InstallmentPlanListFilter } from './types.js';

export interface InstallmentPlanRepository {
  create(plan: InstallmentPlan): Promise<InstallmentPlan>;
  findById(id: string): Promise<InstallmentPlan | null>;
  update(plan: InstallmentPlan): Promise<InstallmentPlan>;
  list(tenantId: string, filter?: InstallmentPlanListFilter): Promise<InstallmentPlan[]>;
  /** All plans with at least one outstanding installment due before `before`. */
  findWithOverdueInstallments(tenantId: string, before: Date): Promise<InstallmentPlan[]>;
}

function clone(plan: InstallmentPlan): InstallmentPlan {
  return {
    ...plan,
    installments: plan.installments.map((installment) => ({ ...installment })),
    metadata: plan.metadata ? { ...plan.metadata } : plan.metadata,
  };
}

export class InMemoryInstallmentPlanRepository implements InstallmentPlanRepository {
  private readonly plans = new Map<string, InstallmentPlan>();

  async create(plan: InstallmentPlan): Promise<InstallmentPlan> {
    const stored = clone(plan);
    this.plans.set(stored.id, stored);
    return clone(stored);
  }

  async findById(id: string): Promise<InstallmentPlan | null> {
    const found = this.plans.get(id);
    return found ? clone(found) : null;
  }

  async update(plan: InstallmentPlan): Promise<InstallmentPlan> {
    const stored = clone(plan);
    this.plans.set(stored.id, stored);
    return clone(stored);
  }

  async list(tenantId: string, filter?: InstallmentPlanListFilter): Promise<InstallmentPlan[]> {
    return Array.from(this.plans.values())
      .filter((plan) => plan.tenantId === tenantId)
      .filter((plan) => (filter?.status ? plan.status === filter.status : true))
      .filter((plan) => (filter?.customerId ? plan.customerId === filter.customerId : true))
      .filter((plan) => (filter?.merchantId ? plan.merchantId === filter.merchantId : true))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async findWithOverdueInstallments(tenantId: string, before: Date): Promise<InstallmentPlan[]> {
    const cutoff = before.getTime();
    return Array.from(this.plans.values())
      .filter((plan) => plan.tenantId === tenantId && plan.status === 'active')
      .filter((plan) =>
        plan.installments.some(
          (installment) =>
            (installment.status === 'scheduled' || installment.status === 'due') &&
            new Date(installment.dueAt).getTime() < cutoff,
        ),
      )
      .map(clone);
  }
}
