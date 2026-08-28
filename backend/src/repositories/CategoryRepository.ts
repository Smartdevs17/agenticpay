/**
 * CategoryRepository.ts — Issue #715
 *
 * Data access layer for payment categories and their payment assignments.
 * Repositories should only interact with the database.
 */

import { prisma } from "../lib/prisma.js";
import { BaseRepository, PaginationOptions, PaginatedResult } from "./BaseRepository.js";
import type { PaymentCategory, PaymentCategoryAssignment } from "@prisma/client";

export type CategoryType =
  | "subscription"
  | "invoice"
  | "donation"
  | "refund"
  | "escrow"
  | "milestone"
  | "other";

export interface CategoryInput {
  name: string;
  type?: CategoryType;
  description?: string;
  color?: string;
  isDefault?: boolean;
}

export class CategoryRepository extends BaseRepository<PaymentCategory> {
  async findById(id: string): Promise<PaymentCategory | null> {
    return prisma.paymentCategory.findUnique({ where: { id } });
  }

  async findAll(options: PaginationOptions): Promise<PaginatedResult<PaymentCategory>> {
    const items = await prisma.paymentCategory.findMany({
      orderBy: { name: "asc" },
      take: options.limit,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length === options.limit;
    return { items, hasMore, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
  }

  async create(data: Partial<PaymentCategory> & { tenantId: string; name: string }): Promise<PaymentCategory> {
    return prisma.paymentCategory.create({ data });
  }

  async update(id: string, data: Partial<PaymentCategory>): Promise<PaymentCategory | null> {
    return prisma.paymentCategory.update({ where: { id }, data });
  }

  async delete(id: string): Promise<boolean> {
    await prisma.paymentCategory.delete({ where: { id } });
    return true;
  }

  async count(filters?: Record<string, unknown>): Promise<number> {
    return prisma.paymentCategory.count({ where: filters });
  }

  // ── Domain-specific queries ─────────────────────────────────────────────

  findByTenant(tenantId: string): Promise<PaymentCategory[]> {
    return prisma.paymentCategory.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  }

  findDefaultByType(tenantId: string, type: CategoryType): Promise<PaymentCategory | null> {
    return prisma.paymentCategory.findFirst({ where: { tenantId, type, isDefault: true } });
  }

  upsertDefaultCategory(tenantId: string, type: CategoryType): Promise<PaymentCategory> {
    return prisma.paymentCategory.upsert({
      where: { tenantId_name: { tenantId, name: type } },
      update: {},
      create: { tenantId, name: type, type, isDefault: true },
    });
  }

  assign(paymentId: string, categoryId: string, assignedBy?: string): Promise<PaymentCategoryAssignment> {
    return prisma.paymentCategoryAssignment.upsert({
      where: { paymentId_categoryId: { paymentId, categoryId } },
      update: { assignedBy },
      create: { paymentId, categoryId, assignedBy },
    });
  }

  async removeAssignment(paymentId: string, categoryId: string): Promise<void> {
    await prisma.paymentCategoryAssignment.delete({
      where: { paymentId_categoryId: { paymentId, categoryId } },
    });
  }

  findAssignmentsForPayment(paymentId: string) {
    return prisma.paymentCategoryAssignment.findMany({
      where: { paymentId },
      include: { category: true },
    });
  }

  findWithPaymentCounts(tenantId: string) {
    return prisma.paymentCategory.findMany({
      where: { tenantId },
      include: { payments: { include: { category: false } } },
    });
  }

  findAssignmentTimestamps(tenantId: string, categoryId: string): Promise<Array<{ createdAt: Date }>> {
    return prisma.paymentCategoryAssignment.findMany({
      where: { categoryId, category: { tenantId } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
  }
}
