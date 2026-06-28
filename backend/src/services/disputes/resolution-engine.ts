/**
 * Dispute Resolution Rules Engine
 *
 * Applies deterministic business rules on top of the AI mediator's recommendation
 * to produce final resolution actions, enforce SLAs, and generate analytics.
 */

import { randomUUID } from 'node:crypto';
import {
  analyzeDispute,
  recordMediatorDecision,
  getAllMediationLogs,
  type DisputeInput,
  type MediationResult,
  type ResolutionRecommendation,
  type AIMediationLog,
} from './ai-mediator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DisputeStatus =
  | 'awaiting_response'
  | 'under_review'
  | 'ai_pending'
  | 'auto_resolved'
  | 'escalated'
  | 'resolved'
  | 'dismissed';

export interface DisputeResolution {
  id: string;
  disputeId: string;
  outcome: ResolutionRecommendation;
  refundAmount?: number;
  currency: string;
  resolvedBy: 'ai' | 'human';
  mediatorId?: string;
  note: string;
  createdAt: string;
}

export interface DisputeRecord {
  id: string;
  paymentId: string;
  amount: number;
  currency: string;
  category: DisputeInput['category'];
  description: string;
  filedBy: string;
  respondentId: string;
  status: DisputeStatus;
  evidence: DisputeInput['evidence'];
  mediationResult?: MediationResult;
  resolution?: DisputeResolution;
  createdAt: string;
  updatedAt: string;
  slaDeadline: string;
}

export interface DisputeAnalyticsSummary {
  total: number;
  autoResolved: number;
  escalated: number;
  humanResolved: number;
  averageConfidenceScore: number;
  resolutionBreakdown: Record<ResolutionRecommendation, number>;
  slaBreachCount: number;
  averageResolutionHours: number;
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const disputes = new Map<string, DisputeRecord>();
const resolutions = new Map<string, DisputeResolution>();

const SLA_HOURS = 72;

function slaDeadline(): string {
  return new Date(Date.now() + SLA_HOURS * 3_600_000).toISOString();
}

// ---------------------------------------------------------------------------
// Engine API
// ---------------------------------------------------------------------------

export async function createDispute(
  input: Omit<DisputeRecord, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'slaDeadline'>
): Promise<DisputeRecord> {
  const now = new Date().toISOString();
  const record: DisputeRecord = {
    ...input,
    id: randomUUID(),
    status: 'awaiting_response',
    createdAt: now,
    updatedAt: now,
    slaDeadline: slaDeadline(),
  };
  disputes.set(record.id, record);
  return record;
}

export async function runAIMediation(disputeId: string): Promise<MediationResult> {
  const dispute = disputes.get(disputeId);
  if (!dispute) throw new Error(`Dispute ${disputeId} not found`);

  dispute.status = 'ai_pending';
  dispute.updatedAt = new Date().toISOString();

  const aiInput: DisputeInput = {
    id: dispute.id,
    description: dispute.description,
    category: dispute.category,
    amount: dispute.amount,
    currency: dispute.currency,
    evidence: dispute.evidence,
  };

  const result = await analyzeDispute(aiInput);
  dispute.mediationResult = result;

  if (result.autoResolved) {
    const resolution = buildResolution(dispute, result, 'ai');
    resolutions.set(resolution.id, resolution);
    dispute.resolution = resolution;
    dispute.status = 'auto_resolved';
  } else {
    dispute.status = 'escalated';
  }

  dispute.updatedAt = new Date().toISOString();
  return result;
}

export async function applyHumanResolution(
  disputeId: string,
  mediatorId: string,
  decision: ResolutionRecommendation,
  note: string,
  refundAmount?: number
): Promise<DisputeResolution> {
  const dispute = disputes.get(disputeId);
  if (!dispute) throw new Error(`Dispute ${disputeId} not found`);

  await recordMediatorDecision(disputeId, decision, note);

  const resolution: DisputeResolution = {
    id: randomUUID(),
    disputeId,
    outcome: decision,
    refundAmount,
    currency: dispute.currency,
    resolvedBy: 'human',
    mediatorId,
    note,
    createdAt: new Date().toISOString(),
  };

  resolutions.set(resolution.id, resolution);
  dispute.resolution = resolution;
  dispute.status = 'resolved';
  dispute.updatedAt = new Date().toISOString();

  return resolution;
}

export function getDispute(id: string): DisputeRecord | undefined {
  return disputes.get(id);
}

export function listDisputes(status?: DisputeStatus): DisputeRecord[] {
  const all = Array.from(disputes.values());
  return status ? all.filter((d) => d.status === status) : all;
}

export function getEscalationQueue(): DisputeRecord[] {
  return listDisputes('escalated');
}

// ---------------------------------------------------------------------------
// SLA enforcement
// ---------------------------------------------------------------------------

export function checkSLABreaches(): DisputeRecord[] {
  const now = new Date();
  const breaches: DisputeRecord[] = [];

  for (const dispute of disputes.values()) {
    if (
      ['awaiting_response', 'under_review', 'ai_pending', 'escalated'].includes(dispute.status) &&
      new Date(dispute.slaDeadline) < now
    ) {
      breaches.push(dispute);
    }
  }

  return breaches;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export function getDisputeAnalytics(): DisputeAnalyticsSummary {
  const logs: AIMediationLog[] = getAllMediationLogs();
  const allDisputes = Array.from(disputes.values());

  const resolutionBreakdown: Record<ResolutionRecommendation, number> = {
    full_refund: 0,
    partial_refund: 0,
    release_to_payee: 0,
    needs_human_review: 0,
  };

  let totalConfidence = 0;
  let autoResolved = 0;
  let escalated = 0;
  let humanResolved = 0;
  let totalResolutionMs = 0;
  let resolvedCount = 0;

  for (const log of logs) {
    resolutionBreakdown[log.recommendation] = (resolutionBreakdown[log.recommendation] ?? 0) + 1;
    totalConfidence += log.confidenceScore;
    if (log.autoResolved) autoResolved++;
    if (log.escalatedToHuman) escalated++;
    if (log.mediatorDecision) humanResolved++;
  }

  for (const d of allDisputes) {
    if (d.resolution) {
      const ms =
        new Date(d.resolution.createdAt).getTime() - new Date(d.createdAt).getTime();
      totalResolutionMs += ms;
      resolvedCount++;
    }
  }

  const slaBreachCount = checkSLABreaches().length;
  const avgHours =
    resolvedCount > 0 ? totalResolutionMs / resolvedCount / 3_600_000 : 0;

  return {
    total: allDisputes.length,
    autoResolved,
    escalated,
    humanResolved,
    averageConfidenceScore: logs.length > 0 ? totalConfidence / logs.length : 0,
    resolutionBreakdown,
    slaBreachCount,
    averageResolutionHours: avgHours,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildResolution(
  dispute: DisputeRecord,
  result: MediationResult,
  resolvedBy: 'ai' | 'human'
): DisputeResolution {
  return {
    id: randomUUID(),
    disputeId: dispute.id,
    outcome: result.recommendation,
    refundAmount: result.suggestedRefundAmount,
    currency: dispute.currency,
    resolvedBy,
    note: result.reasoning,
    createdAt: new Date().toISOString(),
  };
}
