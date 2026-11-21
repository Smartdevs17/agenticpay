// Sandbox Database Service
// Provides database persistence for sandbox accounts and transactions

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

export interface CreateSandboxAccountParams {
  tenantId: string;
  userId?: string;
  name: string;
  email: string;
  walletAddress: string;
  fakeBalance: number;
  currency?: string;
  expiresAt?: Date;
}

export interface CreateSandboxTransactionParams {
  accountId: string;
  fromAddress: string;
  toAddress: string;
  amount: number;
  currency?: string;
  type?: string;
  mockData?: any;
}

export class SandboxDatabaseService {
  /**
   * Create a sandbox account with fake balance
   */
  async createAccount(params: CreateSandboxAccountParams) {
    const account = await prisma.sandboxAccount.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        name: params.name,
        email: params.email,
        walletAddress: params.walletAddress,
        fakeBalance: params.fakeBalance,
        currency: params.currency || 'XLM',
        expiresAt: params.expiresAt,
      },
    });

    return account;
  }

  /**
   * Get sandbox account by ID
   */
  async getAccountById(id: string) {
    return await prisma.sandboxAccount.findUnique({
      where: { id },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
  }

  /**
   * Get sandbox account by wallet address
   */
  async getAccountByWalletAddress(walletAddress: string) {
    return await prisma.sandboxAccount.findUnique({
      where: { walletAddress },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
  }

  /**
   * Get sandbox account by tenant and email
   */
  async getAccountByTenantEmail(tenantId: string, email: string) {
    return await prisma.sandboxAccount.findUnique({
      where: {
        tenantId_email: {
          tenantId,
          email,
        },
      },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
  }

  /**
   * List all sandbox accounts for a tenant
   */
  async listAccountsByTenant(tenantId: string, options: { activeOnly?: boolean } = {}) {
    const where: any = { tenantId };
    if (options.activeOnly) {
      where.isActive = true;
    }

    return await prisma.sandboxAccount.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { transactions: true },
        },
      },
    });
  }

  /**
   * Update account balance
   */
  async updateAccountBalance(accountId: string, newBalance: number) {
    return await prisma.sandboxAccount.update({
      where: { id: accountId },
      data: { fakeBalance: newBalance },
    });
  }

  /**
   * Deactivate sandbox account
   */
  async deactivateAccount(accountId: string) {
    return await prisma.sandboxAccount.update({
      where: { id: accountId },
      data: { isActive: false },
    });
  }

  /**
   * Delete sandbox account (soft delete)
   */
  async deleteAccount(accountId: string) {
    return await prisma.sandboxAccount.update({
      where: { id: accountId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Create a sandbox transaction
   */
  async createTransaction(params: CreateSandboxTransactionParams) {
    const txHash = this.generateTxHash();

    const transaction = await prisma.sandboxTransaction.create({
      data: {
        accountId: params.accountId,
        txHash,
        fromAddress: params.fromAddress,
        toAddress: params.toAddress,
        amount: params.amount,
        currency: params.currency || 'XLM',
        type: params.type || 'payment',
        mockData: params.mockData,
      },
    });

    return transaction;
  }

  /**
   * Get transaction by hash
   */
  async getTransactionByHash(txHash: string) {
    return await prisma.sandboxTransaction.findUnique({
      where: { txHash },
      include: {
        account: true,
      },
    });
  }

  /**
   * Update transaction status
   */
  async updateTransactionStatus(txHash: string, status: string) {
    const updateData: any = { status };
    if (status === 'success' || status === 'completed') {
      updateData.confirmedAt = new Date();
    }

    return await prisma.sandboxTransaction.update({
      where: { txHash },
      data: updateData,
    });
  }

  /**
   * List transactions for an account
   */
  async listTransactionsByAccount(accountId: string, options: { status?: string } = {}) {
    const where: any = { accountId };
    if (options.status) {
      where.status = options.status;
    }

    return await prisma.sandboxTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get sandbox statistics for a tenant
   */
  async getTenantStatistics(tenantId: string) {
    const [accountCount, transactionCount, totalBalance] = await Promise.all([
      prisma.sandboxAccount.count({
        where: { tenantId, isActive: true },
      }),
      prisma.sandboxTransaction.count({
        where: {
          account: { tenantId },
        },
      }),
      prisma.sandboxAccount.aggregate({
        where: { tenantId, isActive: true },
        _sum: { fakeBalance: true },
      }),
    ]);

    return {
      accountCount,
      transactionCount,
      totalBalance: totalBalance._sum.fakeBalance || 0,
    };
  }

  /**
   * Cleanup expired sandbox accounts
   */
  async cleanupExpiredAccounts() {
    const expiredAccounts = await prisma.sandboxAccount.findMany({
      where: {
        expiresAt: {
          lte: new Date(),
        },
        isActive: true,
      },
    });

    const deactivated = await prisma.sandboxAccount.updateMany({
      where: {
        expiresAt: {
          lte: new Date(),
        },
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    return {
      deactivatedCount: deactivated.count,
      expiredAccounts: expiredAccounts.map((a: any) => a.id),
    };
  }

  /**
   * Cleanup old sandbox data (older than specified days)
   */
  async cleanupOldData(daysOld: number = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const deletedTransactions = await prisma.sandboxTransaction.deleteMany({
      where: {
        createdAt: {
          lte: cutoffDate,
        },
        account: {
          isActive: false,
        },
      },
    });

    const deletedAccounts = await prisma.sandboxAccount.deleteMany({
      where: {
        createdAt: {
          lte: cutoffDate,
        },
        isActive: false,
        deletedAt: {
          not: null,
        },
      },
    });

    return {
      deletedTransactionsCount: deletedTransactions.count,
      deletedAccountsCount: deletedAccounts.count,
    };
  }

  /**
   * Generate a mock transaction hash
   */
  private generateTxHash(): string {
    const chars = '0123456789abcdef';
    let hash = '';
    for (let i = 0; i < 64; i++) {
      hash += chars[Math.floor(Math.random() * chars.length)];
    }
    return hash;
  }
}

export default SandboxDatabaseService;
