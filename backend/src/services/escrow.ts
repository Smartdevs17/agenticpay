import { randomUUID } from 'node:crypto';

export type EscrowMilestoneStatus = 'pending' | 'submitted' | 'approved' | 'released' | 'disputed' | 'refunded';
export type EscrowStatus = 'draft' | 'funded' | 'in_progress' | 'completed' | 'disputed' | 'refunded';

export type EscrowMilestoneInput = {
  title: string;
  description?: string;
  amount: number;
  completionCriteria: string;
};

export type EscrowMilestoneRecord = {
  id: string;
  title: string;
  description?: string;
  amount: number;
  completionCriteria: string;
  status: EscrowMilestoneStatus;
  submissionUrl: string | null;
  submissionNotes: string | null;
  approvedAt: string | null;
  disputedAt: string | null;
  disputeReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EscrowAgreement = {
  id: string;
  projectId: string;
  payerId: string;
  payeeId: string;
  currency: string;
  totalAmount: number;
  fundedAmount: number;
  status: EscrowStatus;
  milestones: EscrowMilestoneRecord[];
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, string>;
};

class EscrowService {
  private escrows = new Map<string, EscrowAgreement>();

  private nowIso(): string {
    return new Date().toISOString();
  }

  createEscrow(input: {
    projectId: string;
    payerId: string;
    payeeId: string;
    currency: string;
    totalAmount: number;
    milestones: EscrowMilestoneInput[];
    metadata?: Record<string, string>;
  }): EscrowAgreement {
    const now = this.nowIso();
    const milestones = input.milestones.map((item) => ({
      id: randomUUID(),
      title: item.title,
      description: item.description,
      amount: Number(item.amount.toFixed(2)),
      completionCriteria: item.completionCriteria,
      status: 'pending' as EscrowMilestoneStatus,
      submissionUrl: null,
      submissionNotes: null,
      approvedAt: null,
      disputedAt: null,
      disputeReason: null,
      createdAt: now,
      updatedAt: now,
    }));

    const escrow: EscrowAgreement = {
      id: randomUUID(),
      projectId: input.projectId,
      payerId: input.payerId,
      payeeId: input.payeeId,
      currency: input.currency.toUpperCase(),
      totalAmount: Number(input.totalAmount.toFixed(2)),
      fundedAmount: 0,
      status: 'draft',
      milestones,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata ?? {},
    };

    this.escrows.set(escrow.id, escrow);
    return escrow;
  }

  listEscrows(): EscrowAgreement[] {
    return [...this.escrows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getEscrow(escrowId: string): EscrowAgreement | undefined {
    return this.escrows.get(escrowId);
  }

  fundEscrow(escrowId: string, amount: number): EscrowAgreement | undefined {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) {
      return undefined;
    }

    escrow.fundedAmount = Number((escrow.fundedAmount + amount).toFixed(2));
    escrow.status = escrow.fundedAmount >= escrow.totalAmount ? 'funded' : 'in_progress';
    escrow.updatedAt = this.nowIso();
    this.escrows.set(escrow.id, escrow);
    return escrow;
  }

  submitMilestone(escrowId: string, milestoneId: string, submissionUrl: string, notes?: string): EscrowMilestoneRecord | undefined {
    const escrow = this.escrows.get(escrowId);
    const milestone = escrow?.milestones.find((item) => item.id === milestoneId);
    if (!escrow || !milestone) {
      return undefined;
    }

    milestone.status = 'submitted';
    milestone.submissionUrl = submissionUrl;
    milestone.submissionNotes = notes ?? null;
    milestone.updatedAt = this.nowIso();
    escrow.status = escrow.status === 'draft' ? 'funded' : 'in_progress';
    escrow.updatedAt = this.nowIso();
    this.escrows.set(escrow.id, escrow);
    return milestone;
  }

  approveMilestone(escrowId: string, milestoneId: string, approvedBy: string): { escrow: EscrowAgreement; milestone: EscrowMilestoneRecord } | undefined {
    const escrow = this.escrows.get(escrowId);
    const milestone = escrow?.milestones.find((item) => item.id === milestoneId);
    if (!escrow || !milestone || milestone.status !== 'submitted') {
      return undefined;
    }

    milestone.status = 'released';
    milestone.approvedAt = this.nowIso();
    milestone.updatedAt = this.nowIso();
    escrow.status = 'in_progress';
    escrow.updatedAt = this.nowIso();

    const allReleased = escrow.milestones.every((item) => item.status === 'released');
    if (allReleased) {
      escrow.status = 'completed';
    }
    this.escrows.set(escrow.id, escrow);
    return { escrow, milestone };
  }

  disputeMilestone(escrowId: string, milestoneId: string, reason: string): EscrowMilestoneRecord | undefined {
    const escrow = this.escrows.get(escrowId);
    const milestone = escrow?.milestones.find((item) => item.id === milestoneId);
    if (!escrow || !milestone || milestone.status === 'approved' || milestone.status === 'released') {
      return undefined;
    }

    milestone.status = 'disputed';
    milestone.disputeReason = reason;
    milestone.disputedAt = this.nowIso();
    milestone.updatedAt = this.nowIso();
    escrow.status = 'disputed';
    escrow.updatedAt = this.nowIso();
    this.escrows.set(escrow.id, escrow);
    return milestone;
  }
}

export const escrowService = new EscrowService();
