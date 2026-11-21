/**
 * backend/src/repositories/SandboxRepository.ts
 *
 * Repository encapsulation for SandboxAccount and SandboxTransaction entities.
 * Queries moved verbatim under Issue #1404 with transaction support.
 */

import { prisma, PrismaClient } from '../lib/prisma.js';

type DbClient = PrismaClient | any;

export class SandboxRepository {
  constructor(private readonly db: DbClient = prisma) {}

  withTransaction(tx: DbClient): SandboxRepository {
    return new SandboxRepository(tx);
  }

  // ── Sandbox Account Queries ────────────────────────────────────────────────

  async createAccount(data: any) {
    return this.db.sandboxAccount.create({ data });
  }

  async findAccountById(id: string, include?: any) {
    return this.db.sandboxAccount.findUnique({
      where: { id },
      include,
    });
  }

  async findAccountByPublicKey(publicKey: string) {
    return this.db.sandboxAccount.findUnique({
      where: { publicKey },
    });
  }

  async findAccountByWalletAddress(walletAddress: string, include?: any) {
    return this.db.sandboxAccount.findUnique({
      where: { walletAddress },
      include,
    });
  }

  async findAccountByTenantEmail(tenantId: string, email: string, include?: any) {
    return this.db.sandboxAccount.findUnique({
      where: {
        tenantId_email: {
          tenantId,
          email,
        },
      },
      include,
    });
  }

  async findAccountByApiKey(apiKey: string) {
    return this.db.sandboxAccount.findUnique({
      where: { apiKey },
    });
  }

  async listAccounts(where: any, orderBy: any = { createdAt: 'desc' }, include?: any) {
    return this.db.sandboxAccount.findMany({
      where,
      orderBy,
      include,
    });
  }

  async updateAccount(id: string, data: any) {
    return this.db.sandboxAccount.update({
      where: { id },
      data,
    });
  }

  async updateAccountBalance(publicKey: string, balance: string | number) {
    return this.db.sandboxAccount.update({
      where: { publicKey },
      data: { balance: String(balance), updatedAt: new Date() },
    });
  }

  async findExpiredAccounts(expirationDate: Date) {
    return this.db.sandboxAccount.findMany({
      where: {
        expiresAt: { lte: expirationDate },
        isActive: true,
      },
    });
  }

  async updateManyAccounts(where: any, data: any) {
    return this.db.sandboxAccount.updateMany({ where, data });
  }

  async deleteManyAccounts(where: any) {
    return this.db.sandboxAccount.deleteMany({ where });
  }

  async countAccounts(where?: any): Promise<number> {
    return this.db.sandboxAccount.count({ where });
  }

  async aggregateAccounts(args: any) {
    return this.db.sandboxAccount.aggregate(args);
  }

  // ── Sandbox Transaction Queries ────────────────────────────────────────────

  async createTransaction(data: any) {
    return this.db.sandboxTransaction.create({ data });
  }

  async findTransactionByHash(hash: string, include?: any) {
    return this.db.sandboxTransaction.findUnique({
      where: { hash },
      include,
    });
  }

  async updateTransaction(txHash: string, data: any) {
    return this.db.sandboxTransaction.update({
      where: { txHash },
      data,
    });
  }

  async listTransactions(where: any, orderBy: any = { createdAt: 'desc' }) {
    return this.db.sandboxTransaction.findMany({
      where,
      orderBy,
    });
  }

  async deleteManyTransactions(where: any) {
    return this.db.sandboxTransaction.deleteMany({ where });
  }

  async countTransactions(where?: any): Promise<number> {
    return this.db.sandboxTransaction.count({ where });
  }
}

export const defaultSandboxRepository = new SandboxRepository();
