/**
 * CategoryRepository.ts — Issue #715
 *
 * Data access layer for payment categories and category assignments.
 * Routes and services should not talk to Prisma directly for this domain —
 * they go through this repository instead.
 */

import { prisma } from '../lib/prisma.js';
import type { PaymentCategory, PaymentCategoryAssignment, PaymentCategoryType } from '@prisma/client';

export interface CreateCategoryInput {
  name: string;
  type?: PaymentCategoryType;
  description?: string;
  color?: string;
  isDefault?: boolean;
}

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

export class CategoryRepository {
  findById(id: string): Promise<PaymentCategory | null> {
    return prisma.paymentCategory.findUnique({ where: { id } });
  }

  findByTenant(tenantId: string): Promise<PaymentCategory[]> {
    return prisma.paymentCategory.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  findDefaultByType(tenantId: string, type: PaymentCategoryType): Promise<PaymentCategory | null> {
    return prisma.paymentCategory.findFirst({ where: { tenantId, type, isDefault: true } });
  }

  create(tenantId: string, data: CreateCategoryInput): Promise<PaymentCategory> {
    return prisma.paymentCategory.create({ data: { tenantId, ...data } });
  }

  update(id: string, data: UpdateCategoryInput): Promise<PaymentCategory> {
    return prisma.paymentCategory.update({ where: { id }, data });
  }

  delete(id: string): Promise<PaymentCategory> {
    return prisma.paymentCategory.delete({ where: { id } });
  }

  upsertDefaultForType(tenantId: string, type: PaymentCategoryType): Promise<PaymentCategory> {
    return prisma.paymentCategory.upsert({
      where: { tenantId_name: { tenantId, name: type } },
      update: {},
      create: { tenantId, name: type, type, isDefault: true },
    });
  }

  // ── Assignments ────────────────────────────────────────────────────────────

  assign(paymentId: string, categoryId: string, assignedBy?: string): Promise<PaymentCategoryAssignment> {
    return prisma.paymentCategoryAssignment.upsert({
      where: { paymentId_categoryId: { paymentId, categoryId } },
      update: { assignedBy },
      create: { paymentId, categoryId, assignedBy },
    });
  }

  removeAssignment(paymentId: string, categoryId: string): Promise<PaymentCategoryAssignment> {
    return prisma.paymentCategoryAssignment.delete({
      where: { paymentId_categoryId: { paymentId, categoryId } },
    });
  }

  findAssignmentsForPayment(paymentId: string) {
    return prisma.paymentCategoryAssignment.findMany({
      where: { paymentId },
      include: { category: true },
    });
  }

  // ── Analytics ────────────────────────────────────────────────────────────────

  findByTenantWithPaymentCounts(tenantId: string) {
    return prisma.paymentCategory.findMany({
      where: { tenantId },
      include: { payments: { include: { category: false } } },
    });
  }

  findAssignmentTimestampsForCategory(tenantId: string, categoryId: string) {
    return prisma.paymentCategoryAssignment.findMany({
      where: { categoryId, category: { tenantId } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
  }
}

export const categoryRepository = new CategoryRepository();
