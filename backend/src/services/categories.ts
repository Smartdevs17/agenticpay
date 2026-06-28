/**
 * Payment Categories Service — Issue #251
 * Auto-categorization rules, manual override, analytics.
 */
import { prisma } from '../lib/prisma.js';

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

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function createCategory(tenantId: string, data: {
  name: string;
  type?: CategoryType;
  description?: string;
  color?: string;
  isDefault?: boolean;
}) {
  return prisma.paymentCategory.create({ data: { tenantId, ...data } });
}

export async function listCategories(tenantId: string) {
  return prisma.paymentCategory.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
}

export async function getCategory(id: string) {
  return prisma.paymentCategory.findUnique({ where: { id } });
}

export async function updateCategory(id: string, data: Partial<{ name: string; type: CategoryType; description: string; color: string; isDefault: boolean }>) {
  return prisma.paymentCategory.update({ where: { id }, data });
}

export async function deleteCategory(id: string) {
  return prisma.paymentCategory.delete({ where: { id } });
}

// ── Assignment ────────────────────────────────────────────────────────────────

export async function assignCategory(paymentId: string, categoryId: string, assignedBy?: string) {
  return prisma.paymentCategoryAssignment.upsert({
    where: { paymentId_categoryId: { paymentId, categoryId } },
    update: { assignedBy },
    create: { paymentId, categoryId, assignedBy },
  });
}

export async function removeAssignment(paymentId: string, categoryId: string) {
  return prisma.paymentCategoryAssignment.delete({
    where: { paymentId_categoryId: { paymentId, categoryId } },
  });
}

export async function getPaymentCategories(paymentId: string) {
  return prisma.paymentCategoryAssignment.findMany({
    where: { paymentId },
    include: { category: true },
  });
}

/**
 * Auto-assign a category to a payment based on rules.
 * Creates default category for tenant if needed.
 */
export async function autoAssignCategory(tenantId: string, paymentId: string, payment: {
  type?: string;
  network?: string;
  metadata?: Record<string, unknown>;
}) {
  const type = inferCategory(payment);
  let category = await prisma.paymentCategory.findFirst({
    where: { tenantId, type, isDefault: true },
  });
  if (!category) {
    category = await prisma.paymentCategory.upsert({
      where: { tenantId_name: { tenantId, name: type } },
      update: {},
      create: { tenantId, name: type, type, isDefault: true },
    });
  }
  return assignCategory(paymentId, category.id);
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export async function getCategoryAnalytics(tenantId: string, fromDate?: Date, toDate?: Date) {
  const categories = await prisma.paymentCategory.findMany({
    where: { tenantId },
    include: { payments: { include: { category: false } } },
  });

  return categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    type: cat.type,
    count: cat.payments.length,
  }));
}

export async function getCategoryTrend(tenantId: string, categoryId: string) {
  const rows = await prisma.paymentCategoryAssignment.findMany({
    where: { categoryId, category: { tenantId } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });

  // Bucket by day
  const trend: Record<string, number> = {};
  for (const row of rows) {
    const day = row.createdAt.toISOString().slice(0, 10);
    trend[day] = (trend[day] ?? 0) + 1;
  }
  return Object.entries(trend).map(([date, count]) => ({ date, count }));
}
