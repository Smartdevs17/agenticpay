/**
 * backend/src/repositories/PaymentRepository.ts
 *
 * Repository encapsulation for Payment entity queries.
 * Queries moved verbatim under Issue #1404 with transaction support.
 */

import { prisma, PrismaClient } from '../lib/prisma.js';

type DbClient = PrismaClient | any;

export interface PaymentCreateInput {
  id?: string;
  amount: number | string;
  currency: string;
  status: string;
  sourceWallet?: string;
  destinationWallet?: string;
  txHash?: string;
  memo?: string;
  metadata?: Record<string, unknown>;
  userId?: string;
  projectId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PaymentUpdateInput {
  status?: string;
  txHash?: string;
  confirmedAt?: Date;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  updatedAt?: Date;
}

export class PaymentRepository {
  constructor(private readonly db: DbClient = prisma) {}

  /** Create a scoped repository instance bound to an active transaction */
  withTransaction(tx: DbClient): PaymentRepository {
    return new PaymentRepository(tx);
  }

  async findById(id: string) {
    return this.db.payment.findUnique({
      where: { id },
    });
  }

  async findByIdOrThrow(id: string) {
    return this.db.payment.findUniqueOrThrow({
      where: { id },
    });
  }

  async findByTxHash(txHash: string) {
    return this.db.payment.findFirst({
      where: { txHash },
    });
  }

  async listByStatus(status: string, limit = 50) {
    return this.db.payment.findMany({
      where: { status },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async listByUser(userId: string, limit = 50, skip = 0) {
    return this.db.payment.findMany({
      where: { userId },
      take: limit,
      skip,
      orderBy: { createdAt: 'desc' },
    });
  }

  async listByTenant(tenantId: string, limit = 50) {
    return this.db.payment.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async create(data: PaymentCreateInput) {
    return this.db.payment.create({
      data,
    });
  }

  async update(id: string, data: PaymentUpdateInput) {
    return this.db.payment.update({
      where: { id },
      data,
    });
  }

  async updateStatus(id: string, status: string, txHash?: string) {
    const data: Record<string, unknown> = { status };
    if (txHash) data.txHash = txHash;
    return this.db.payment.update({
      where: { id },
      data,
    });
  }

  async countByStatus(status?: string): Promise<number> {
    return this.db.payment.count({
      where: status ? { status } : undefined,
    });
  }
}

export const defaultPaymentRepository = new PaymentRepository();
