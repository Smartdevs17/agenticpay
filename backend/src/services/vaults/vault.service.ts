import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { prisma } from '../../lib/prisma.js';
import type { PaymentVault, VaultMilestone, MilestoneRelease } from '@prisma/client';

export type { PaymentVault, VaultMilestone, MilestoneRelease };

export interface CreateMilestoneInput {
  name: string;
  amountPercent: number;
  deadline: Date;
  approverAddress: string;
}

export interface CreateVaultInput {
  depositorAddress: string;
  recipientAddress: string;
  totalAmount: number;
  currency: string;
  network: string;
  milestones: CreateMilestoneInput[];
}

export interface VaultFilters {
  status?: string;
  depositorAddress?: string;
}

export class VaultService extends BaseService {
  async createVault(input: CreateVaultInput, tenantId: string): Promise<Result<PaymentVault>> {
    const totalPercent = input.milestones.reduce((sum, m) => sum + m.amountPercent, 0);
    if (totalPercent !== 100) {
      return this.validationFailure('Milestone percentages must sum to 100', { total: totalPercent });
    }

    try {
      const vault = await prisma.paymentVault.create({
        data: {
          tenantId,
          depositorAddress: input.depositorAddress,
          recipientAddress: input.recipientAddress,
          totalAmount: input.totalAmount,
          currency: input.currency,
          network: input.network,
          milestones: {
            create: input.milestones.map((m) => ({
              name: m.name,
              amountPercent: m.amountPercent,
              deadline: m.deadline,
              approverAddress: m.approverAddress,
            })),
          },
        },
        include: { milestones: true },
      });
      return this.ok(vault);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async getVault(id: string, tenantId: string): Promise<Result<PaymentVault & { milestones: VaultMilestone[] }>> {
    try {
      const vault = await prisma.paymentVault.findFirst({
        where: { id, tenantId, deletedAt: null },
        include: { milestones: { where: { deletedAt: null } } },
      });
      if (!vault) return this.notFoundFailure('PaymentVault', id);
      return this.ok(vault);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async listVaults(tenantId: string, filters?: VaultFilters): Promise<Result<PaymentVault[]>> {
    try {
      const vaults = await prisma.paymentVault.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...(filters?.status ? { status: filters.status as never } : {}),
          ...(filters?.depositorAddress ? { depositorAddress: filters.depositorAddress } : {}),
        },
        include: { milestones: { where: { deletedAt: null } } },
        orderBy: { createdAt: 'desc' },
      });
      return this.ok(vaults);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async recordContractDeployment(id: string, tenantId: string, contractAddress: string, contractVaultId: string): Promise<Result<PaymentVault>> {
    try {
      const existing = await prisma.paymentVault.findFirst({ where: { id, tenantId, deletedAt: null } });
      if (!existing) return this.notFoundFailure('PaymentVault', id);
      const vault = await prisma.paymentVault.update({
        where: { id },
        data: { contractAddress, contractVaultId, status: 'active' },
      });
      return this.ok(vault);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async approveMilestone(milestoneId: string, approverAddress: string): Promise<Result<VaultMilestone>> {
    try {
      const milestone = await prisma.vaultMilestone.findFirst({ where: { id: milestoneId, deletedAt: null } });
      if (!milestone) return this.notFoundFailure('VaultMilestone', milestoneId);
      if (milestone.status !== 'pending') {
        return this.conflictFailure(`Milestone is already ${milestone.status}`);
      }
      if (milestone.approverAddress.toLowerCase() !== approverAddress.toLowerCase()) {
        return this.forbiddenFailure('Only the designated approver can approve this milestone');
      }

      const updated = await prisma.vaultMilestone.update({
        where: { id: milestoneId },
        data: { status: 'approved' },
      });
      return this.ok(updated);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async releaseMilestone(milestoneId: string, txHash: string | undefined, triggeredBy: string): Promise<Result<MilestoneRelease>> {
    try {
      const milestone = await prisma.vaultMilestone.findFirst({ where: { id: milestoneId, deletedAt: null } });
      if (!milestone) return this.notFoundFailure('VaultMilestone', milestoneId);
      if (milestone.status !== 'approved') {
        return this.conflictFailure('Milestone must be approved before release');
      }

      const release = await prisma.$transaction(async (tx) => {
        await tx.vaultMilestone.update({ where: { id: milestoneId }, data: { status: 'released', releasedAt: new Date() } });
        const r = await tx.milestoneRelease.create({
          data: { milestoneId, txHash: txHash ?? null, triggeredBy },
        });

        // Auto-complete vault if all milestones released
        const vault = await tx.paymentVault.findFirst({ where: { id: milestone.vaultId } });
        if (vault) {
          const pending = await tx.vaultMilestone.count({ where: { vaultId: vault.id, status: { notIn: ['released', 'expired'] }, deletedAt: null } });
          if (pending === 0) await tx.paymentVault.update({ where: { id: vault.id }, data: { status: 'completed' } });
        }
        return r;
      });

      return this.ok(release);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async raiseDispute(vaultId: string, _raisedBy: string, tenantId: string): Promise<Result<PaymentVault>> {
    try {
      const vault = await prisma.paymentVault.findFirst({ where: { id: vaultId, tenantId, deletedAt: null } });
      if (!vault) return this.notFoundFailure('PaymentVault', vaultId);
      if (vault.status !== 'active') return this.conflictFailure(`Vault is ${vault.status}, cannot dispute`);

      const updated = await prisma.paymentVault.update({ where: { id: vaultId }, data: { status: 'disputed' } });
      return this.ok(updated);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async resolveDispute(vaultId: string, resolution: 'release' | 'refund', tenantId: string): Promise<Result<PaymentVault>> {
    try {
      const vault = await prisma.paymentVault.findFirst({ where: { id: vaultId, tenantId, deletedAt: null } });
      if (!vault) return this.notFoundFailure('PaymentVault', vaultId);
      if (vault.status !== 'disputed') return this.conflictFailure('Vault is not in disputed state');

      const newStatus = resolution === 'release' ? 'completed' : 'refunded';
      const updated = await prisma.paymentVault.update({ where: { id: vaultId }, data: { status: newStatus } });
      return this.ok(updated);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async checkExpiredMilestones(): Promise<number> {
    const now = new Date();
    try {
      const result = await prisma.vaultMilestone.updateMany({
        where: { status: 'pending', deadline: { lt: now }, deletedAt: null },
        data: { status: 'expired' },
      });
      return result.count;
    } catch {
      return 0;
    }
  }
}

export const vaultService = new VaultService();
