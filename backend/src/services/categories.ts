/**
 * Payment Categories Service — Issue #251 / #715
 * Auto-categorization rules, manual override, analytics.
 *
 * Business logic only — data access goes through CategoryRepository.
 */
import { categoryRepository, CategoryRepository, CreateCategoryInput, UpdateCategoryInput } from '../repositories/CategoryRepository.js';
import type { PaymentCategoryType as PrismaCategoryType } from '@prisma/client';

export type CategoryType = 'subscription' | 'invoice' | 'donation' | 'refund' | 'escrow' | 'milestone' | 'other';

export interface CategoryScore {
  category: CategoryType;
  confidence: number;
}

type PaymentSignal = { type?: string; network?: string; metadata?: Record<string, unknown> };

// Issue #963: weighted signals replace the old first-match rule list, so a
// payment can score against several categories at once and callers get a
// confidence they can threshold on.
// ponytail: heuristic weighted-rule scorer, not a trained model — upgrade to
// a real classifier once labeled categorization corrections accumulate.
const CATEGORY_SIGNALS: Array<{
  match: (p: PaymentSignal) => boolean;
  category: CategoryType;
  weight: number;
}> = [
  { match: (p) => p.type === 'refund', category: 'refund', weight: 0.95 },
  { match: (p) => p.type === 'milestone_payment', category: 'milestone', weight: 0.95 },
  { match: (p) => p.type === 'full_payment' && p.network === 'stellar', category: 'escrow', weight: 0.8 },
  { match: (p) => p.type === 'full_payment', category: 'escrow', weight: 0.3 },
  { match: (p) => typeof (p.metadata as Record<string, unknown> | undefined)?.subscriptionId === 'string', category: 'subscription', weight: 0.9 },
  { match: (p) => typeof (p.metadata as Record<string, unknown> | undefined)?.invoiceId === 'string', category: 'invoice', weight: 0.9 },
  { match: (p) => (p.metadata as Record<string, unknown> | undefined)?.isDonation === true, category: 'donation', weight: 0.95 },
];

/**
 * Scores every category against the payment's signals and returns them
 * ranked highest-confidence first. Multiple signals for the same category
 * stack (capped at 1); no signals firing means 'other' at full confidence.
 */
export function scoreCategories(payment: PaymentSignal): CategoryScore[] {
  const scores = new Map<CategoryType, number>();
  for (const signal of CATEGORY_SIGNALS) {
    if (!signal.match(payment)) continue;
    scores.set(signal.category, Math.min(1, (scores.get(signal.category) ?? 0) + signal.weight));
  }

  if (scores.size === 0) return [{ category: 'other', confidence: 1 }];

  return [...scores.entries()]
    .map(([category, confidence]) => ({ category, confidence }))
    .sort((a, b) => b.confidence - a.confidence);
}

export function inferCategory(payment: PaymentSignal): CategoryType {
  return scoreCategories(payment)[0].category;
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
   * Ranks candidate categories for a payment with confidence scores, without
   * persisting anything. Lets callers preview/override before assigning.
   */
  suggestCategories(payment: PaymentSignal): CategoryScore[] {
    return scoreCategories(payment);
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
