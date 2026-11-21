/**
 * backend/src/repositories/InvoiceRepository.ts
 *
 * Repository encapsulation for Invoice entity queries.
 * Queries moved verbatim under Issue #1404 with transaction support.
 */

import { prisma, PrismaClient } from '../lib/prisma.js';

type DbClient = PrismaClient | any;

export interface InvoiceCreateInput {
  id?: string;
  merchantId: string;
  amount: number | string;
  currency: string;
  status: string;
  dueDate?: Date;
  items?: any;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface InvoiceUpdateInput {
  status?: string;
  paidAt?: Date;
  metadata?: Record<string, unknown>;
  updatedAt?: Date;
}

export class InvoiceRepository {
  constructor(private readonly db: DbClient = prisma) {}

  withTransaction(tx: DbClient): InvoiceRepository {
    return new InvoiceRepository(tx);
  }

  async findById(id: string) {
    return this.db.invoice.findUnique({
      where: { id },
    });
  }

  async listByMerchant(merchantId: string, limit = 50, skip = 0) {
    return this.db.invoice.findMany({
      where: { merchantId },
      take: limit,
      skip,
      orderBy: { createdAt: 'desc' },
    });
  }

  async listByStatus(status: string, limit = 50) {
    return this.db.invoice.findMany({
      where: { status },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: InvoiceCreateInput) {
    return this.db.invoice.create({
      data,
    });
  }

  async update(id: string, data: InvoiceUpdateInput) {
    return this.db.invoice.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return this.db.invoice.delete({
      where: { id },
    });
  }

  async count(merchantId?: string): Promise<number> {
    return this.db.invoice.count({
      where: merchantId ? { merchantId } : undefined,
    });
  }
}

export const defaultInvoiceRepository = new InvoiceRepository();
