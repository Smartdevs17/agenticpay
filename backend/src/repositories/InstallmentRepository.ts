/**
 * backend/src/repositories/InstallmentRepository.ts
 *
 * Repository encapsulation for InstallmentPlan and Installment entities.
 * Queries moved verbatim under Issue #1404 with transaction support.
 */

import { prisma, PrismaClient } from '../lib/prisma.js';

type DbClient = PrismaClient | any;

export class InstallmentRepository {
  constructor(private readonly db: DbClient = prisma) {}

  withTransaction(tx: DbClient): InstallmentRepository {
    return new InstallmentRepository(tx);
  }

  async findPlanById(id: string) {
    return this.db.installmentPlan.findUnique({
      where: { id },
      include: { installments: true },
    });
  }

  async createPlan(data: any) {
    return this.db.installmentPlan.create({ data });
  }

  async updatePlanStatus(id: string, status: string) {
    return this.db.installmentPlan.update({
      where: { id },
      data: { status, updatedAt: new Date() },
    });
  }

  async updateInstallment(id: string, data: any) {
    return this.db.installment.update({
      where: { id },
      data,
    });
  }

  async listPlansByCustomer(customerId: string, limit = 50) {
    return this.db.installmentPlan.findMany({
      where: { customerId },
      include: { installments: true },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const defaultInstallmentRepository = new InstallmentRepository();
