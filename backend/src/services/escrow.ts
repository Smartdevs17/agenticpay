import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { auditService } from './auditService.js';
import { multisigService } from './multisig.js';

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
  multisigPolicy?: MultisigEscrowPolicy;
  releaseRequest?: MultisigReleaseRequest;
}

export interface MultisigEscrowPolicy {
  groupId: string;
  threshold: number;
  challengePeriodMs: number;
}

export type ReleaseRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'executed';

export interface MultisigReleaseRequest {
  id: string;
  escrowId: string;
  initiator: string;
  type: 'release_to_freelancer' | 'refund_to_client' | 'split';
  approvals: Array<{ signer: string; signature: string; timestamp: number }>;
  rejections: Array<{ signer: string; signature: string; reason?: string; timestamp: number }>;
  status: ReleaseRequestStatus;
  createdAt: number;
  expiresAt: number | null;
  challengeEndsAt: number;
  executedAt?: number;
}

export interface EscrowEvent {
  type: string;
  escrowId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export class EscrowService extends EventEmitter {
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
    multisigPolicy?: MultisigEscrowPolicy;
  }): Promise<EscrowRecord> {
    const escrow: EscrowRecord = {
      id: randomUUID(),
      status: 'pending',
      createdAt: Date.now(),
      deadline: params.deadline,
      signatures: [],
      multisigPolicy: params.multisigPolicy,
      ...params,
    };
    this.escrows.set(escrow.id, escrow);

    await auditService.logAction({ action: 'escrow.created', resource: 'escrow', resourceId: escrow.id, details: { projectId: params.projectId, amount: params.amount, asset: params.asset } });
    this.emitEscrowEvent({ type: 'escrow.created', escrowId: escrow.id, data: { projectId: params.projectId, amount: params.amount }, timestamp: Date.now() });
    return escrow;
  }

  async fundEscrow(escrowId: string, txHash: string): Promise<EscrowRecord | null> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow || escrow.status !== 'pending') return null;
    escrow.status = 'funded';
    escrow.fundedAt = Date.now();
    this.escrows.set(escrowId, escrow);
    await auditService.logAction({ action: 'escrow.funded', resource: 'escrow', resourceId: escrowId, details: { txHash } });
    this.emitEscrowEvent({ type: 'escrow.funded', escrowId, data: { txHash }, timestamp: Date.now() });
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
    this.emitEscrowEvent({ type: 'escrow.disputed', escrowId, data: { raisedBy }, timestamp: Date.now() });
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
    this.emitEscrowEvent({ type: 'escrow.resolved', escrowId, data: { releaseType: release.type, approvedBy: release.approvedBy }, timestamp: Date.now() });
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
    this.emitEscrowEvent({ type: 'escrow.appealed', escrowId, data: { appealTarget: appealTargetAddress }, timestamp: Date.now() });
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
    this.emitEscrowEvent({ type: 'escrow.timeout_release', escrowId, data: { reason: 'arbitrator_timeout' }, timestamp: Date.now() });
    return escrow;
  }

  // ---------------------------------------------------------------------------
  // Multi-sig escrow release (#564)
  // ---------------------------------------------------------------------------

  async createReleaseRequest(escrowId: string, initiator: string, type: MultisigReleaseRequest['type']): Promise<MultisigReleaseRequest> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) throw new Error('Escrow not found');
    if (escrow.status !== 'funded') throw new Error('Escrow must be funded to create a release request');
    if (!escrow.multisigPolicy) throw new Error('Escrow has no multisig policy configured');

    if (escrow.releaseRequest && escrow.releaseRequest.status === 'pending') {
      throw new Error('A pending release request already exists');
    }

    const group = multisigService.getGroup(escrow.multisigPolicy.groupId);
    if (!group) throw new Error('Multisig group not found');

    const normalizedInitiator = initiator.trim().toLowerCase();
    if (!group.walletAddresses.includes(normalizedInitiator)) {
      throw new Error('Initiator is not a signer of the multisig group');
    }

    const now = Date.now();
    const request: MultisigReleaseRequest = {
      id: randomUUID(),
      escrowId,
      initiator: normalizedInitiator,
      type,
      approvals: [{ signer: normalizedInitiator, signature: 'implicit', timestamp: now }],
      rejections: [],
      status: 'pending',
      createdAt: now,
      expiresAt: group.timeoutSeconds ? now + group.timeoutSeconds * 1000 : null,
      challengeEndsAt: now + escrow.multisigPolicy.challengePeriodMs,
    };

    escrow.releaseRequest = request;
    this.escrows.set(escrowId, escrow);

    await auditService.logAction({
      action: 'escrow.release_request.created',
      resource: 'escrow',
      resourceId: escrowId,
      details: { requestId: request.id, initiator: normalizedInitiator, type, challengeEndsAt: request.challengeEndsAt },
    });
    this.emitEscrowEvent({
      type: 'escrow.release_request.created',
      escrowId,
      data: { requestId: request.id, initiator: normalizedInitiator, type, challengeEndsAt: request.challengeEndsAt },
      timestamp: now,
    });

    return request;
  }

  async approveReleaseRequest(escrowId: string, signer: string, signature: string): Promise<MultisigReleaseRequest> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) throw new Error('Escrow not found');
    if (!escrow.releaseRequest || escrow.releaseRequest.status !== 'pending') {
      throw new Error('No pending release request');
    }
    if (!escrow.multisigPolicy) throw new Error('Escrow has no multisig policy');

    const group = multisigService.getGroup(escrow.multisigPolicy.groupId);
    if (!group) throw new Error('Multisig group not found');

    const normalizedSigner = signer.trim().toLowerCase();
    if (!group.walletAddresses.includes(normalizedSigner)) {
      throw new Error('Signer is not a member of the multisig group');
    }

    const request = escrow.releaseRequest;

    if (request.expiresAt && Date.now() > request.expiresAt) {
      request.status = 'expired';
      this.escrows.set(escrowId, escrow);
      throw new Error('Release request has expired');
    }

    if (request.approvals.some(a => a.signer === normalizedSigner)) {
      throw new Error('Signer has already approved');
    }
    if (request.rejections.some(r => r.signer === normalizedSigner)) {
      throw new Error('Signer has already rejected');
    }

    const now = Date.now();
    request.approvals.push({ signer: normalizedSigner, signature, timestamp: now });

    await auditService.logAction({
      action: 'escrow.release_request.approved',
      resource: 'escrow',
      resourceId: escrowId,
      details: { requestId: request.id, signer: normalizedSigner, approvalCount: request.approvals.length, threshold: escrow.multisigPolicy.threshold },
    });
    this.emitEscrowEvent({
      type: 'escrow.release_request.approval',
      escrowId,
      data: { requestId: request.id, signer: normalizedSigner, approvalCount: request.approvals.length, threshold: escrow.multisigPolicy.threshold },
      timestamp: now,
    });

    if (request.approvals.length >= escrow.multisigPolicy.threshold) {
      await this._executeReleaseRequest(escrow, request);
    }

    this.escrows.set(escrowId, escrow);
    return request;
  }

  async rejectReleaseRequest(escrowId: string, signer: string, signature: string, reason?: string): Promise<MultisigReleaseRequest> {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) throw new Error('Escrow not found');
    if (!escrow.releaseRequest || escrow.releaseRequest.status !== 'pending') {
      throw new Error('No pending release request');
    }
    if (!escrow.multisigPolicy) throw new Error('Escrow has no multisig policy');

    const group = multisigService.getGroup(escrow.multisigPolicy.groupId);
    if (!group) throw new Error('Multisig group not found');

    const normalizedSigner = signer.trim().toLowerCase();
    if (!group.walletAddresses.includes(normalizedSigner)) {
      throw new Error('Signer is not a member of the multisig group');
    }

    const request = escrow.releaseRequest;
    if (request.approvals.some(a => a.signer === normalizedSigner)) {
      throw new Error('Signer has already approved');
    }
    if (request.rejections.some(r => r.signer === normalizedSigner)) {
      throw new Error('Signer has already rejected');
    }

    const now = Date.now();
    request.rejections.push({ signer: normalizedSigner, signature, reason, timestamp: now });

    const blockingThreshold = group.walletAddresses.length - escrow.multisigPolicy.threshold + 1;
    if (request.rejections.length >= blockingThreshold) {
      request.status = 'rejected';
    }

    await auditService.logAction({
      action: 'escrow.release_request.rejected',
      resource: 'escrow',
      resourceId: escrowId,
      details: { requestId: request.id, signer: normalizedSigner, reason, rejectionCount: request.rejections.length, blockingThreshold },
    });
    this.emitEscrowEvent({
      type: 'escrow.release_request.rejection',
      escrowId,
      data: { requestId: request.id, signer: normalizedSigner, reason, rejectionCount: request.rejections.length, blockingThreshold },
      timestamp: now,
    });

    this.escrows.set(escrowId, escrow);
    return request;
  }

  private async _executeReleaseRequest(escrow: EscrowRecord, request: MultisigReleaseRequest): Promise<void> {
    const now = Date.now();
    if (now < request.challengeEndsAt) {
      return;
    }

    const approvedSigners = request.approvals.map(a => a.signer);
    escrow.status = request.type === 'refund_to_client' ? 'refunded' : 'released';
    escrow.release = { type: request.type, approvedBy: approvedSigners };
    escrow.releasedAt = now;
    request.status = 'executed';
    request.executedAt = now;

    await auditService.logAction({
      action: 'escrow.release_request.executed',
      resource: 'escrow',
      resourceId: escrow.id,
      details: { requestId: request.id, type: request.type, approvedBy: approvedSigners },
    });
    this.emitEscrowEvent({
      type: 'escrow.released',
      escrowId: escrow.id,
      data: { requestId: request.id, type: request.type, approvedBy: approvedSigners },
      timestamp: now,
    });
  }

  async executeReadyReleases(): Promise<number> {
    let executed = 0;
    const now = Date.now();
    for (const escrow of this.escrows.values()) {
      if (!escrow.releaseRequest || escrow.releaseRequest.status !== 'pending') continue;
      if (!escrow.multisigPolicy) continue;
      const request = escrow.releaseRequest;
      if (request.approvals.length < escrow.multisigPolicy.threshold) continue;
      if (now < request.challengeEndsAt) continue;
      await this._executeReleaseRequest(escrow, request);
      this.escrows.set(escrow.id, escrow);
      executed++;
    }
    return executed;
  }

  getReleaseRequest(escrowId: string): MultisigReleaseRequest | undefined {
    return this.escrows.get(escrowId)?.releaseRequest;
  }

  // ---------------------------------------------------------------------------
  // Query helpers
  // ---------------------------------------------------------------------------

  async getEscrow(escrowId: string): Promise<EscrowRecord | undefined> {
    return this.escrows.get(escrowId);
  }

  async listEscrows(status?: EscrowStatus): Promise<EscrowRecord[]> {
    const all = Array.from(this.escrows.values());
    return status ? all.filter(e => e.status === status) : all;
  }

  private emitEscrowEvent(event: EscrowEvent): void {
    this.emit('escrow:event', event);
  }
}

export const escrowService = new EscrowService();

/** Create an independent EscrowService instance (for testing). */
export function createEscrowService(): EscrowService {
  return new EscrowService();
}
