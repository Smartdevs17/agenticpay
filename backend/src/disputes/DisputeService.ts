import { randomUUID } from 'node:crypto';
import { auditService } from '../services/auditService.js';
import { ArbitratorService } from './ArbitratorService.js';

export type DisputeStatus = 'opened' | 'evidence_gathering' | 'under_review' | 'resolved' | 'appealed' | 'closed';

export type ResolutionType = 'refund' | 'release' | 'split';

export interface EvidenceItem {
  id: string;
  type: 'document' | 'image' | 'message' | 'other';
  title: string;
  description?: string;
  url: string;
  uploadedBy: string;
  uploadedAt: number;
}

export interface DisputeRecord {
  id: string;
  projectId: string;
  escrowId: string;
  raisedBy: string;
  raisedAgainst: string;
  reason: string;
  status: DisputeStatus;
  evidence: EvidenceItem[];
  arbitratorId?: string;
  resolution?: {
    type: ResolutionType;
    description: string;
    approvedBy: string;
    approvedAt: number;
    refundAmount?: string;
    releaseAmount?: string;
    splitRatio?: { partyA: number; partyB: number };
  };
  appealTarget?: string;
  appealDeadline?: number;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  auditTimeline: Array<{ action: string; by: string; at: number; detail?: string }>;
}

export class DisputeService {
  private disputes = new Map<string, DisputeRecord>();
  private arbitratorService: ArbitratorService;

  constructor() {
    this.arbitratorService = new ArbitratorService();
  }

  async createDispute(params: {
    projectId: string;
    escrowId: string;
    raisedBy: string;
    raisedAgainst: string;
    reason: string;
  }): Promise<DisputeRecord> {
    const dispute: DisputeRecord = {
      id: randomUUID(),
      status: 'opened',
      evidence: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      auditTimeline: [{ action: 'dispute.created', by: params.raisedBy, at: Date.now() }],
      ...params,
    };

    this.disputes.set(dispute.id, dispute);

    const arbitrator = this.arbitratorService.assignArbitrator(dispute.id);
    if (arbitrator) {
      dispute.arbitratorId = arbitrator.id;
      dispute.status = 'under_review';
      dispute.auditTimeline.push({ action: 'arbitrator.assigned', by: 'system', at: Date.now(), detail: arbitrator.id });
      this.disputes.set(dispute.id, dispute);
    }

    await auditService.logAction({ action: 'dispute.created', resource: 'dispute', resourceId: dispute.id, details: { projectId: params.projectId, raisedBy: params.raisedBy, reason: params.reason } });
    return dispute;
  }

  async addEvidence(disputeId: string, evidence: Omit<EvidenceItem, 'id' | 'uploadedAt'>): Promise<DisputeRecord | null> {
    const dispute = this.disputes.get(disputeId);
    if (!dispute || dispute.status === 'closed' || dispute.status === 'resolved') return null;

    const item: EvidenceItem = { ...evidence, id: randomUUID(), uploadedAt: Date.now() };
    dispute.evidence.push(item);
    if (dispute.status === 'opened') dispute.status = 'evidence_gathering';
    dispute.updatedAt = Date.now();
    dispute.auditTimeline.push({ action: 'evidence.added', by: evidence.uploadedBy, at: Date.now(), detail: evidence.title });
    this.disputes.set(disputeId, dispute);
    return dispute;
  }

  async resolveDispute(disputeId: string, resolution: {
    type: ResolutionType;
    description: string;
    approvedBy: string;
    refundAmount?: string;
    releaseAmount?: string;
    splitRatio?: { partyA: number; partyB: number };
  }): Promise<DisputeRecord | null> {
    const dispute = this.disputes.get(disputeId);
    if (!dispute || dispute.status === 'closed') return null;

    dispute.status = 'resolved';
    dispute.resolution = { ...resolution, approvedAt: Date.now() };
    dispute.resolvedAt = Date.now();
    dispute.updatedAt = Date.now();
    dispute.auditTimeline.push({ action: 'dispute.resolved', by: resolution.approvedBy, at: Date.now(), detail: resolution.type });
    this.disputes.set(disputeId, dispute);

    await auditService.logAction({ action: 'dispute.resolved', resource: 'dispute', resourceId: disputeId, details: { type: resolution.type, approvedBy: resolution.approvedBy } });
    return dispute;
  }

  async appealDispute(disputeId: string, appealTarget: string): Promise<DisputeRecord | null> {
    const dispute = this.disputes.get(disputeId);
    if (!dispute || dispute.status !== 'resolved') return null;

    dispute.status = 'appealed';
    dispute.appealTarget = appealTarget;
    dispute.appealDeadline = Date.now() + 14 * 24 * 60 * 60 * 1000;
    dispute.updatedAt = Date.now();
    dispute.auditTimeline.push({ action: 'dispute.appealed', by: 'system', at: Date.now(), detail: `Appealed to ${appealTarget}` });
    this.disputes.set(disputeId, dispute);
    return dispute;
  }

  async closeDispute(disputeId: string, closedBy: string): Promise<DisputeRecord | null> {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) return null;

    dispute.status = 'closed';
    dispute.updatedAt = Date.now();
    dispute.auditTimeline.push({ action: 'dispute.closed', by: closedBy, at: Date.now() });
    this.disputes.set(disputeId, dispute);
    return dispute;
  }

  getDispute(disputeId: string): DisputeRecord | undefined {
    return this.disputes.get(disputeId);
  }

  listDisputes(status?: DisputeStatus): DisputeRecord[] {
    const all = Array.from(this.disputes.values());
    return status ? all.filter(d => d.status === status) : all;
  }

  getDisputesByUser(userId: string): DisputeRecord[] {
    return Array.from(this.disputes.values()).filter(d => d.raisedBy === userId || d.raisedAgainst === userId);
  }

  getArbitratorService(): ArbitratorService {
    return this.arbitratorService;
  }
}

export const disputeService = new DisputeService();
