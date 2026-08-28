/**
 * CategoryService.ts — Issue #715
 *
 * Business logic for payment categories: auto-categorization rules, manual
 * assignment, and analytics. Talks only to CategoryRepository — no direct
 * Prisma access — and raises `AppError` for domain-level failures so the
 * existing error-handling middleware (which keys off `instanceof AppError`)
 * maps them to the same HTTP responses this endpoint returned before.
 */

import { AppError } from "../middleware/errorHandler.js";
import { CategoryRepository, CategoryInput, CategoryType } from "../repositories/CategoryRepository.js";

const AUTO_RULES: Array<{
  match: (p: { type?: string; network?: string; metadata?: Record<string, unknown> }) => boolean;
  category: CategoryType;
}> = [
  { match: (p) => p.type === "refund", category: "refund" },
  { match: (p) => p.type === "milestone_payment", category: "milestone" },
  { match: (p) => p.type === "full_payment" && p.network === "stellar", category: "escrow" },
  { match: (p) => typeof (p.metadata as Record<string, unknown> | undefined)?.subscriptionId === "string", category: "subscription" },
  { match: (p) => typeof (p.metadata as Record<string, unknown> | undefined)?.invoiceId === "string", category: "invoice" },
  { match: (p) => (p.metadata as Record<string, unknown> | undefined)?.isDonation === true, category: "donation" },
];

/** Infer a payment's category from its type/network/metadata. Pure — no I/O. */
export function inferCategory(payment: { type?: string; network?: string; metadata?: Record<string, unknown> }): CategoryType {
  for (const rule of AUTO_RULES) {
    if (rule.match(payment)) return rule.category;
  }
  return "other";
}

export class CategoryService {
  constructor(private categoryRepository: CategoryRepository) {}

  async createCategory(tenantId: string, data: CategoryInput) {
    return this.categoryRepository.create({ tenantId, ...data });
  }

  listCategories(tenantId: string) {
    return this.categoryRepository.findByTenant(tenantId);
  }

  async getCategory(id: string) {
    const category = await this.categoryRepository.findById(id);
    if (!category) throw new AppError(404, "Category not found", "NOT_FOUND");
    return category;
  }

  async updateCategory(id: string, data: Partial<CategoryInput>) {
    const existing = await this.categoryRepository.findById(id);
    if (!existing) throw new AppError(404, "Category not found", "NOT_FOUND");
    return this.categoryRepository.update(id, data as never);
  }

  async deleteCategory(id: string): Promise<void> {
    const existing = await this.categoryRepository.findById(id);
    if (!existing) throw new AppError(404, "Category not found", "NOT_FOUND");
    await this.categoryRepository.delete(id);
  }

  assignCategory(paymentId: string, categoryId: string, assignedBy?: string) {
    return this.categoryRepository.assign(paymentId, categoryId, assignedBy);
  }

  async removeAssignment(paymentId: string, categoryId: string): Promise<void> {
    await this.categoryRepository.removeAssignment(paymentId, categoryId);
  }

  getPaymentCategories(paymentId: string) {
    return this.categoryRepository.findAssignmentsForPayment(paymentId);
  }

  /** Auto-assign a category to a payment based on rules, creating the tenant's default category for that type if needed. */
  async autoAssignCategory(
    tenantId: string,
    paymentId: string,
    payment: { type?: string; network?: string; metadata?: Record<string, unknown> },
  ) {
    const type = inferCategory(payment);
    let category = await this.categoryRepository.findDefaultByType(tenantId, type);
    if (!category) {
      category = await this.categoryRepository.upsertDefaultCategory(tenantId, type);
    }
    return this.categoryRepository.assign(paymentId, category.id);
  }

  async getCategoryAnalytics(tenantId: string, _fromDate?: Date, _toDate?: Date) {
    const categories = await this.categoryRepository.findWithPaymentCounts(tenantId);
    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      type: cat.type,
      count: cat.payments.length,
    }));
  }

  async getCategoryTrend(tenantId: string, categoryId: string) {
    const rows = await this.categoryRepository.findAssignmentTimestamps(tenantId, categoryId);

    const trend: Record<string, number> = {};
    for (const row of rows) {
      const day = row.createdAt.toISOString().slice(0, 10);
      trend[day] = (trend[day] ?? 0) + 1;
    }
    return Object.entries(trend).map(([date, count]) => ({ date, count }));
  }
}
