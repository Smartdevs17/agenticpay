import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';

export interface ProposeInput {
  tenantId: string;
  proposer: string;
  description: string;
  target: string;
  amount: string;
  token?: string;
  calldata?: string;
  threshold: number;
  timelockDelay: number;
}

export class TreasuryService {
  async propose(data: ProposeInput) {
    const executeAfter = new Date(Date.now() + data.timelockDelay * 1000);
    return prisma.treasuryProposal.create({
      data: {
        tenantId: data.tenantId,
        proposalId: BigInt(Date.now()),
        proposer: data.proposer,
        description: data.description,
        target: data.target,
        amount: data.amount,
        token: data.token,
        calldata: data.calldata,
        status: 'pending',
        threshold: data.threshold,
        timelockDelay: BigInt(data.timelockDelay),
        executeAfter,
      },
    });
  }

  async getProposal(id: string) {
    const proposal = await prisma.treasuryProposal.findUnique({
      where: { id },
      include: { approvals: true, execution: true },
    });
    if (!proposal) throw new AppError(404, 'Proposal not found', 'PROPOSAL_NOT_FOUND');
    return proposal;
  }

  async listProposals(tenantId: string, options?: { status?: string; limit?: number }) {
    const where: any = { tenantId };
    if (options?.status) where.status = options.status;
    return prisma.treasuryProposal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
      include: {
        approvals: { take: 20 },
        execution: true,
      },
    });
  }

  async approve(proposalId: string, signer: string) {
    const proposal = await prisma.treasuryProposal.findUnique({ where: { id: proposalId } });
    if (!proposal) throw new AppError(404, 'Proposal not found', 'PROPOSAL_NOT_FOUND');
    if (proposal.status !== 'pending') throw new AppError(400, 'Proposal is not pending', 'PROPOSAL_NOT_PENDING');

    const existing = await prisma.treasuryApproval.findUnique({
      where: { proposalId_signer: { proposalId, signer } },
    });
    if (existing) throw new AppError(400, 'Already voted', 'ALREADY_VOTED');

    await prisma.$transaction(async (tx) => {
      await tx.treasuryApproval.create({
        data: { proposalId, signer, approved: true },
      });

      const updated = await tx.treasuryProposal.update({
        where: { id: proposalId },
        data: { approvalCount: { increment: 1 } },
      });

      if (updated.approvalCount >= updated.threshold) {
        await tx.treasuryProposal.update({
          where: { id: proposalId },
          data: { status: 'approved' },
        });
      }
    });

    return this.getProposal(proposalId);
  }

  async reject(proposalId: string, signer: string) {
    const proposal = await prisma.treasuryProposal.findUnique({ where: { id: proposalId } });
    if (!proposal) throw new AppError(404, 'Proposal not found', 'PROPOSAL_NOT_FOUND');
    if (proposal.status !== 'pending' && proposal.status !== 'approved') {
      throw new AppError(400, 'Proposal cannot be rejected in current state', 'INVALID_STATE');
    }

    const existing = await prisma.treasuryApproval.findUnique({
      where: { proposalId_signer: { proposalId, signer } },
    });
    if (existing) throw new AppError(400, 'Already voted', 'ALREADY_VOTED');

    await prisma.treasuryApproval.create({
      data: { proposalId, signer, approved: false },
    });

    return this.getProposal(proposalId);
  }

  async execute(proposalId: string, executedBy: string, txHash?: string) {
    const proposal = await prisma.treasuryProposal.findUnique({ where: { id: proposalId } });
    if (!proposal) throw new AppError(404, 'Proposal not found', 'PROPOSAL_NOT_FOUND');
    if (proposal.status !== 'approved') throw new AppError(400, 'Proposal is not approved', 'PROPOSAL_NOT_APPROVED');
    if (new Date() < proposal.executeAfter) throw new AppError(400, 'Timelock not elapsed', 'TIMELOCK_NOT_ELAPSED');

    const [execution] = await prisma.$transaction([
      prisma.treasuryExecution.create({
        data: { proposalId, txHash, executedBy },
      }),
      prisma.treasuryProposal.update({
        where: { id: proposalId },
        data: { status: 'executed', executedAt: new Date() },
      }),
    ]);

    return execution;
  }

  async cancel(proposalId: string, caller: string) {
    const proposal = await prisma.treasuryProposal.findUnique({ where: { id: proposalId } });
    if (!proposal) throw new AppError(404, 'Proposal not found', 'PROPOSAL_NOT_FOUND');
    if (proposal.status === 'executed') throw new AppError(400, 'Already executed', 'ALREADY_EXECUTED');
    if (proposal.status === 'cancelled') throw new AppError(400, 'Already cancelled', 'ALREADY_CANCELLED');

    if (proposal.proposer !== caller) throw new AppError(403, 'Only proposer can cancel', 'NOT_PROPOSER');

    return prisma.treasuryProposal.update({
      where: { id: proposalId },
      data: { status: 'cancelled' },
    });
  }
}

export const treasuryService = new TreasuryService();
