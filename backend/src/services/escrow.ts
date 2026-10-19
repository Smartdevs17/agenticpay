import { randomUUID } from 'node:crypto';
import { auditService } from './auditService.js';

export type EscrowStatus = 'pending' | 'funded' | 'disputed' | 'released' | 'refunded' | 'expired';

export interface EscrowRelease {
  type: 'release_to_freelancer' | 'refund_to_client' | 'split';
  freelancerPercent?: number;
  clientPercent?: number;
  approvedBy: string[];
}

export interface EscrowRecord {
  id: string;
  projectId: string;
  clientAddress: string;
  freelancerAddress: string;
  arbitratorAddresses: string[];
  amount: string;
  asset: string;
  network: string;
  status: EscrowStatus;
  createdAt: number;
  fundedAt?: number;
  disputedAt?: number;
  releasedAt?: number;
  deadline: number;
  release?: EscrowRelease;
  appealDeadline?: number;
  appealTarget?: string;
  signatures: string[];
}

class EscrowService {
  private escrows = new Map<string, EscrowRecord>();

  async createEscrow(params: {
    projectId: string;
    clientAddress: string;
    freelancerAddress: string;
    arbitratorAddresses: string[];
    amount: string;
    asset: string;
    network: string;
    deadline: number;
  }): Promise<EscrowRecord> {
    const escrow: EscrowRecord = {
      id: randomUUID(),
      status: 'pending',
      createdAt: Date.now(),
      deadline: params.deadline,
      signatures: [],
      ...params,
    };
    this.escrows.set(escrow.id, escrow);

    await auditService.logAction({ action: 'escrow.created', resource: 'escrow', resourceId: escrow.id, details: { projectId: params.projectId, amount: params.amount, asset: params.asset } });
    return escrow;
  }

  async fundEscrow(escrowId: string, txHash: string): Promise<EscrowRecord | null> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow || escrow.status !== 'pending') return null;
    escrow.status = 'funded';
    escrow.fundedAt = Date.now();
    this.escrows.set(escrowId, escrow);
    await auditService.logAction({ action: 'escrow.funded', resource: 'escrow', resourceId: escrowId, details: { txHash } });
    return escrow;
  }

  async raiseDispute(escrowId: string, raisedBy: string): Promise<EscrowRecord | null> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow || escrow.status !== 'funded') return null;
    escrow.status = 'disputed';
    escrow.disputedAt = Date.now();
    escrow.appealDeadline = Date.now() + 7 * 24 * 60 * 60 * 1000;
    this.escrows.set(escrowId, escrow);
    await auditService.logAction({ action: 'escrow.disputed', resource: 'escrow', resourceId: escrowId, details: { raisedBy } });
    return escrow;
  }

  async resolveDispute(escrowId: string, release: EscrowRelease): Promise<EscrowRecord | null> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow || escrow.status !== 'disputed') return null;

    const requiredSigs = Math.ceil((escrow.arbitratorAddresses.length * 2) / 3);
    if (release.approvedBy.length < requiredSigs) {
      throw new Error(`Need ${requiredSigs} arbitrator signatures, got ${release.approvedBy.length}`);
    }

    escrow.status = release.type === 'refund_to_client' ? 'refunded' : 'released';
    escrow.release = release;
    escrow.releasedAt = Date.now();
    this.escrows.set(escrowId, escrow);
    await auditService.logAction({ action: 'escrow.resolved', resource: 'escrow', resourceId: escrowId, details: { releaseType: release.type, approvedBy: release.approvedBy } });
    return escrow;
  }

  async appealDispute(escrowId: string, appealTargetAddress: string): Promise<EscrowRecord | null> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow || escrow.status !== 'disputed') return null;
    if (escrow.appealDeadline && Date.now() > escrow.appealDeadline) {
      throw new Error('Appeal deadline has passed');
    }
    escrow.appealTarget = appealTargetAddress;
    escrow.appealDeadline = Date.now() + 14 * 24 * 60 * 60 * 1000;
    escrow.arbitratorAddresses = [appealTargetAddress];
    this.escrows.set(escrowId, escrow);
    await auditService.logAction({ action: 'escrow.appealed', resource: 'escrow', resourceId: escrowId, details: { appealTarget: appealTargetAddress } });
    return escrow;
  }

  async timeoutRelease(escrowId: string): Promise<EscrowRecord | null> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow || escrow.status !== 'disputed') return null;
    if (escrow.deadline > Date.now()) return null;

    escrow.status = 'released';
    escrow.release = { type: 'release_to_freelancer', approvedBy: ['system_timeout'] };
    escrow.releasedAt = Date.now();
    this.escrows.set(escrowId, escrow);
    await auditService.logAction({ action: 'escrow.timeout_release', resource: 'escrow', resourceId: escrowId, details: { reason: 'arbitrator_timeout' } });
    return escrow;
  }

  async getEscrow(escrowId: string): Promise<EscrowRecord | undefined> {
    return this.escrows.get(escrowId);
  }

  async listEscrows(status?: EscrowStatus): Promise<EscrowRecord[]> {
    const all = Array.from(this.escrows.values());
    return status ? all.filter(e => e.status === status) : all;
  }
}

export const escrowService = new EscrowService();
