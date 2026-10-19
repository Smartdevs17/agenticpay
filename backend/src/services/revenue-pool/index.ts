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

/** Basis points in a full allocation. Recipients of one pool may not exceed this in total. */
export const TOTAL_SHARE_BPS = 10_000;

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

      if (input.ratioBps <= 0 || input.ratioBps > TOTAL_SHARE_BPS) {
        return this.validationFailure('ratioBps must be between 1 and 10000');
      }

      const existing = await prisma.revenueRecipient.findUnique({
        where: { poolId_wallet: { poolId, wallet: input.wallet } },
      });
      if (existing) return this.conflictFailure('Recipient already exists in this pool');

      // Rejecting only per-recipient overshoot still lets a pool be configured to pay
      // out more than it receives (e.g. three recipients at 5000 bps each). Enforce
      // the invariant across the whole pool.
      const allocated = await this.allocatedBps(poolId);
      if (allocated + input.ratioBps > TOTAL_SHARE_BPS) {
        return this.validationFailure(
          `Recipient shares would total ${allocated + input.ratioBps} bps, exceeding the ${TOTAL_SHARE_BPS} bps a pool can allocate`,
          { allocatedBps: allocated, requestedBps: input.ratioBps, maxBps: TOTAL_SHARE_BPS },
        );
      }

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

      if (input.ratioBps <= 0 || input.ratioBps > TOTAL_SHARE_BPS) {
        return this.validationFailure('ratioBps must be between 1 and 10000');
      }

      const current = await prisma.revenueRecipient.findUnique({
        where: { poolId_wallet: { poolId, wallet } },
      });
      if (!current) return this.notFoundFailure('RevenueRecipient', wallet);

      const allocated = await this.allocatedBps(poolId);
      const projected = allocated - current.ratioBps + input.ratioBps;
      if (projected > TOTAL_SHARE_BPS) {
        return this.validationFailure(
          `Recipient shares would total ${projected} bps, exceeding the ${TOTAL_SHARE_BPS} bps a pool can allocate`,
          { allocatedBps: allocated, requestedBps: input.ratioBps, maxBps: TOTAL_SHARE_BPS },
        );
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

      const existing = await prisma.revenueRecipient.findUnique({
        where: { poolId_wallet: { poolId, wallet } },
      });
      if (!existing) return this.notFoundFailure('RevenueRecipient', wallet);

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

  /** Total basis points currently allocated across a pool's recipients. */
  private async allocatedBps(poolId: string): Promise<number> {
    const aggregate = await prisma.revenueRecipient.aggregate({
      where: { poolId },
      _sum: { ratioBps: true },
    });
    return aggregate._sum.ratioBps ?? 0;
  }

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

      const txHash = input.txHash.trim();
      if (!txHash) {
        return this.validationFailure('Transaction hash is required');
      }

      // A chain reorg or a retried indexer replays the same transaction. Recording it
      // twice would double-count the distribution against every recipient's balance.
      const duplicate = await prisma.revenueDistribution.findFirst({
        where: { poolId, txHash },
      });
      if (duplicate) return this.ok(duplicate);

      const distribution = await prisma.revenueDistribution.create({
        data: {
          poolId,
          txHash,
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
