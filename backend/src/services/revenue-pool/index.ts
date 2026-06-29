import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { prisma } from '../../lib/prisma.js';
import type {
  RevenuePool,
  RevenueRecipient,
  RevenueDistribution,
  PoolStatus,
  DistributionStatus,
} from '@prisma/client';

export type {
  RevenuePool,
  RevenueRecipient,
  RevenueDistribution,
  PoolStatus,
  DistributionStatus,
};

// ─── DTOs ──────────────────────────────────────────────────────────────────────

export interface CreateRevenuePoolInput {
  tenantId: string;
  name: string;
  chain: 'soroban' | 'evm';
  contractId: string;
}

export interface UpdateRevenuePoolInput {
  name?: string;
  chain?: 'soroban' | 'evm';
  contractId?: string;
  status?: PoolStatus;
}

export interface AddRecipientInput {
  wallet: string;
  ratioBps: number;
}

export interface UpdateRecipientInput {
  ratioBps: number;
}

export interface RecipientBalance {
  wallet: string;
  ratioBps: number;
  accumulated: string;
}

export interface RecordDistributionInput {
  txHash: string;
  amount: string;
}

// ─── Service ────────────────────────────────────────────────────────────────────

export class RevenuePoolService extends BaseService {
  // ── Pool CRUD ────────────────────────────────────────────────────────────────

  async createPool(input: CreateRevenuePoolInput): Promise<Result<RevenuePool>> {
    try {
      if (input.chain !== 'soroban' && input.chain !== 'evm') {
        return this.validationFailure('Chain must be "soroban" or "evm"');
      }
      if (!input.name.trim()) {
        return this.validationFailure('Pool name is required');
      }
      if (!input.contractId.trim()) {
        return this.validationFailure('Contract ID is required');
      }

      const pool = await prisma.revenuePool.create({
        data: {
          tenantId: input.tenantId,
          name: input.name.trim(),
          chain: input.chain,
          contractId: input.contractId.trim(),
        },
      });
      return this.ok(pool);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async getPool(id: string, tenantId: string): Promise<Result<RevenuePool>> {
    try {
      const pool = await prisma.revenuePool.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!pool) return this.notFoundFailure('RevenuePool', id);
      return this.ok(pool);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async listPools(tenantId: string): Promise<Result<RevenuePool[]>> {
    try {
      const pools = await prisma.revenuePool.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      return this.ok(pools);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async updatePool(
    id: string,
    tenantId: string,
    input: UpdateRevenuePoolInput,
  ): Promise<Result<RevenuePool>> {
    try {
      const existing = await prisma.revenuePool.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!existing) return this.notFoundFailure('RevenuePool', id);

      if (input.chain !== undefined && input.chain !== 'soroban' && input.chain !== 'evm') {
        return this.validationFailure('Chain must be "soroban" or "evm"');
      }

      const pool = await prisma.revenuePool.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.chain !== undefined ? { chain: input.chain } : {}),
          ...(input.contractId !== undefined ? { contractId: input.contractId.trim() } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      return this.ok(pool);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async deletePool(id: string, tenantId: string): Promise<Result<void>> {
    try {
      const existing = await prisma.revenuePool.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!existing) return this.notFoundFailure('RevenuePool', id);

      await prisma.revenuePool.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      return this.ok(undefined as void);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  // ── Recipients ──────────────────────────────────────────────────────────────

  async addRecipient(
    poolId: string,
    tenantId: string,
    input: AddRecipientInput,
  ): Promise<Result<RevenueRecipient>> {
    try {
      const pool = await prisma.revenuePool.findFirst({
        where: { id: poolId, tenantId, deletedAt: null },
      });
      if (!pool) return this.notFoundFailure('RevenuePool', poolId);

      if (input.ratioBps <= 0 || input.ratioBps > 10_000) {
        return this.validationFailure('ratioBps must be between 1 and 10_000');
      }

      const existing = await prisma.revenueRecipient.findUnique({
        where: { poolId_wallet: { poolId, wallet: input.wallet } },
      });
      if (existing) return this.conflictFailure('Recipient already exists in this pool');

      const recipient = await prisma.revenueRecipient.create({
        data: {
          poolId,
          wallet: input.wallet,
          ratioBps: input.ratioBps,
          accumulated: '0',
        },
      });
      return this.ok(recipient);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async updateRecipientRatio(
    poolId: string,
    wallet: string,
    tenantId: string,
    input: UpdateRecipientInput,
  ): Promise<Result<RevenueRecipient>> {
    try {
      const pool = await prisma.revenuePool.findFirst({
        where: { id: poolId, tenantId, deletedAt: null },
      });
      if (!pool) return this.notFoundFailure('RevenuePool', poolId);

      if (input.ratioBps <= 0 || input.ratioBps > 10_000) {
        return this.validationFailure('ratioBps must be between 1 and 10_000');
      }

      const recipient = await prisma.revenueRecipient.update({
        where: { poolId_wallet: { poolId, wallet } },
        data: { ratioBps: input.ratioBps },
      });
      return this.ok(recipient);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async removeRecipient(
    poolId: string,
    wallet: string,
    tenantId: string,
  ): Promise<Result<void>> {
    try {
      const pool = await prisma.revenuePool.findFirst({
        where: { id: poolId, tenantId, deletedAt: null },
      });
      if (!pool) return this.notFoundFailure('RevenuePool', poolId);

      await prisma.revenueRecipient.delete({
        where: { poolId_wallet: { poolId, wallet } },
      });
      return this.ok(undefined as void);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async listRecipients(poolId: string, tenantId: string): Promise<Result<RevenueRecipient[]>> {
    try {
      const pool = await prisma.revenuePool.findFirst({
        where: { id: poolId, tenantId, deletedAt: null },
      });
      if (!pool) return this.notFoundFailure('RevenuePool', poolId);

      const recipients = await prisma.revenueRecipient.findMany({
        where: { poolId },
        orderBy: { createdAt: 'asc' },
      });
      return this.ok(recipients);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  // ── Balances ────────────────────────────────────────────────────────────────

  async getBalances(poolId: string, tenantId: string): Promise<Result<RecipientBalance[]>> {
    try {
      const pool = await prisma.revenuePool.findFirst({
        where: { id: poolId, tenantId, deletedAt: null },
      });
      if (!pool) return this.notFoundFailure('RevenuePool', poolId);

      const recipients = await prisma.revenueRecipient.findMany({
        where: { poolId },
      });

      const balances: RecipientBalance[] = recipients.map((r) => ({
        wallet: r.wallet,
        ratioBps: r.ratioBps,
        accumulated: r.accumulated,
      }));
      return this.ok(balances);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  // ── Distributions ───────────────────────────────────────────────────────────

  async recordDistribution(
    poolId: string,
    tenantId: string,
    input: RecordDistributionInput,
  ): Promise<Result<RevenueDistribution>> {
    try {
      const pool = await prisma.revenuePool.findFirst({
        where: { id: poolId, tenantId, deletedAt: null },
      });
      if (!pool) return this.notFoundFailure('RevenuePool', poolId);

      if (!input.txHash.trim()) {
        return this.validationFailure('Transaction hash is required');
      }

      const distribution = await prisma.revenueDistribution.create({
        data: {
          poolId,
          txHash: input.txHash.trim(),
          amount: input.amount,
          status: 'pending',
        },
      });
      return this.ok(distribution);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async updateDistributionStatus(
    id: string,
    poolId: string,
    tenantId: string,
    status: DistributionStatus,
    txHash?: string,
  ): Promise<Result<RevenueDistribution>> {
    try {
      const pool = await prisma.revenuePool.findFirst({
        where: { id: poolId, tenantId, deletedAt: null },
      });
      if (!pool) return this.notFoundFailure('RevenuePool', poolId);

      const distribution = await prisma.revenueDistribution.findFirst({
        where: { id, poolId },
      });
      if (!distribution) return this.notFoundFailure('RevenueDistribution', id);

      const updated = await prisma.revenueDistribution.update({
        where: { id },
        data: {
          status,
          ...(txHash !== undefined ? { txHash } : {}),
        },
      });
      return this.ok(updated);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async listDistributions(
    poolId: string,
    tenantId: string,
  ): Promise<Result<RevenueDistribution[]>> {
    try {
      const pool = await prisma.revenuePool.findFirst({
        where: { id: poolId, tenantId, deletedAt: null },
      });
      if (!pool) return this.notFoundFailure('RevenuePool', poolId);

      const distributions = await prisma.revenueDistribution.findMany({
        where: { poolId },
        orderBy: { createdAt: 'desc' },
      });
      return this.ok(distributions);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }
}

export const revenuePoolService = new RevenuePoolService();
