/**
 * Payment Categories Service — Issue #251 / #715
 * Auto-categorization rules, manual override, analytics.
 *
 * Business logic only — data access goes through CategoryRepository.
 */
import { categoryRepository, CategoryRepository, CreateCategoryInput, UpdateCategoryInput } from '../repositories/CategoryRepository.js';
import type { PaymentCategoryType as PrismaCategoryType } from '@prisma/client';

export type CategoryType = 'subscription' | 'invoice' | 'donation' | 'refund' | 'escrow' | 'milestone' | 'other';

const AUTO_RULES: Array<{
  match: (p: { type?: string; network?: string; metadata?: Record<string, unknown> }) => boolean;
  category: CategoryType;
}> = [
  { match: (p) => p.type === 'refund', category: 'refund' },
  { match: (p) => p.type === 'milestone_payment', category: 'milestone' },
  { match: (p) => p.type === 'full_payment' && p.network === 'stellar', category: 'escrow' },
  { match: (p) => typeof (p.metadata as Record<string, unknown> | undefined)?.subscriptionId === 'string', category: 'subscription' },
  { match: (p) => typeof (p.metadata as Record<string, unknown> | undefined)?.invoiceId === 'string', category: 'invoice' },
  { match: (p) => (p.metadata as Record<string, unknown> | undefined)?.isDonation === true, category: 'donation' },
];

export function inferCategory(payment: { type?: string; network?: string; metadata?: Record<string, unknown> }): CategoryType {
  for (const rule of AUTO_RULES) {
    if (rule.match(payment)) return rule.category;
  }
  return 'other';
}

export class CategoriesService {
  constructor(private readonly repo: CategoryRepository = categoryRepository) {}

  // ── CRUD ─────────────────────────────────────────────────────────────────

  createCategory(tenantId: string, data: CreateCategoryInput) {
    return this.repo.create(tenantId, data);
  }

  listCategories(tenantId: string) {
    return this.repo.findByTenant(tenantId);
  }

  getCategory(id: string) {
    return this.repo.findById(id);
  }

  updateCategory(id: string, data: UpdateCategoryInput) {
    return this.repo.update(id, data);
  }

  deleteCategory(id: string) {
    return this.repo.delete(id);
  }

  // ── Assignment ────────────────────────────────────────────────────────────

  assignCategory(paymentId: string, categoryId: string, assignedBy?: string) {
    return this.repo.assign(paymentId, categoryId, assignedBy);
  }

  removeAssignment(paymentId: string, categoryId: string) {
    return this.repo.removeAssignment(paymentId, categoryId);
  }

  getPaymentCategories(paymentId: string) {
    return this.repo.findAssignmentsForPayment(paymentId);
  }

  /**
   * Auto-assign a category to a payment based on rules.
   * Creates default category for tenant if needed.
   */
  async autoAssignCategory(
    tenantId: string,
    paymentId: string,
    payment: { type?: string; network?: string; metadata?: Record<string, unknown> },
  ) {
    const type = inferCategory(payment) as PrismaCategoryType;
    const category =
      (await this.repo.findDefaultByType(tenantId, type)) ?? (await this.repo.upsertDefaultForType(tenantId, type));
    return this.assignCategory(paymentId, category.id);
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  async getCategoryAnalytics(tenantId: string) {
    const categories = await this.repo.findByTenantWithPaymentCounts(tenantId);
    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      type: cat.type,
      count: cat.payments.length,
    }));
  }

  async getCategoryTrend(tenantId: string, categoryId: string) {
    const rows = await this.repo.findAssignmentTimestampsForCategory(tenantId, categoryId);

    // Bucket by day
    const trend: Record<string, number> = {};
    for (const row of rows) {
      const day = row.createdAt.toISOString().slice(0, 10);
      trend[day] = (trend[day] ?? 0) + 1;
    }
    return Object.entries(trend).map(([date, count]) => ({ date, count }));
  }
}

export const categoriesService = new CategoriesService();
