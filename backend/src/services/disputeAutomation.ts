/**
 * disputeAutomation.ts — Issue #707
 *
 * Escrow dispute automation with evidence scoring.
 * Extends the existing dispute-resolution service with automated evidence
 * quality assessment, priority ranking, and escalation recommendations.
 */

import { randomUUID } from 'node:crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export type EvidenceType = 'document' | 'screenshot' | 'transaction_proof' | 'communication' | 'other';

export interface EvidenceItem {
  id: string;
  disputeId: string;
  type: EvidenceType;
  url: string;
  description: string;
  submittedBy: string;
  submittedAt: string;
}

export interface EvidenceScore {
  evidenceId: string;
  relevanceScore: number;    // 0-100
  credibilityScore: number;  // 0-100
  completenessScore: number; // 0-100
  overallScore: number;      // weighted average
  flags: string[];
}

export interface DisputePriority {
  disputeId: string;
  priorityScore: number;     // 0-100, higher = more urgent
  recommendedAction: 'auto_resolve' | 'fast_track' | 'standard' | 'escalate';
  evidenceStrength: 'strong' | 'moderate' | 'weak' | 'insufficient';
  estimatedResolutionHours: number;
}

export interface AutomationConfig {
  autoResolveThreshold: number;    // score >= this → auto-resolve
  fastTrackThreshold: number;      // score >= this → fast-track
  escalateThreshold: number;       // score <= this → escalate
  minEvidenceForAutoResolve: number;
  maxAgeForAutoResolveHours: number;
}

const DEFAULT_CONFIG: AutomationConfig = {
  autoResolveThreshold: 85,
  fastTrackThreshold: 70,
  escalateThreshold: 30,
  minEvidenceForAutoResolve: 2,
  maxAgeForAutoResolveHours: 48,
};

// ─── Store ───────────────────────────────────────────────────────────────────

const evidenceStore = new Map<string, EvidenceItem[]>();
const scoreStore = new Map<string, EvidenceScore[]>();

// ─── Evidence Scoring ────────────────────────────────────────────────────────

const TYPE_WEIGHTS: Record<EvidenceType, number> = {
  transaction_proof: 1.0,
  document: 0.9,
  screenshot: 0.7,
  communication: 0.6,
  other: 0.4,
};

function scoreEvidenceItem(item: EvidenceItem, allItems: EvidenceItem[]): EvidenceScore {
  // Relevance: based on type weight
  const relevanceScore = Math.round(TYPE_WEIGHTS[item.type] * 100);

  // Credibility: based on description quality and submission pattern
  const hasDescription = item.description.length > 20;
  const duplicateCount = allItems.filter(
    (i) => i.type === item.type && i.submittedBy === item.submittedBy
  ).length;
  const credibilityScore = Math.max(0, Math.min(100,
    (hasDescription ? 70 : 40) - (duplicateCount > 1 ? 10 : 0)
  ));

  // Completeness: presence of supporting details
  const completenessScore = item.url ? 80 : 40;

  // Weighted overall
  const overallScore = Math.round(
    relevanceScore * 0.4 + credibilityScore * 0.35 + completenessScore * 0.25
  );

  const flags: string[] = [];
  if (duplicateCount > 1) flags.push('repeated_submission_type');
  if (!hasDescription) flags.push('vague_description');

  return {
    evidenceId: item.id,
    relevanceScore,
    credibilityScore,
    completenessScore,
    overallScore,
    flags,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function addEvidence(
  disputeId: string,
  type: EvidenceType,
  url: string,
  description: string,
  submittedBy: string,
): EvidenceItem {
  const item: EvidenceItem = {
    id: `ev_${randomUUID().slice(0, 8)}`,
    disputeId,
    type,
    url,
    description,
    submittedBy,
    submittedAt: new Date().toISOString(),
  };

  const items = evidenceStore.get(disputeId) || [];
  items.push(item);
  evidenceStore.set(disputeId, items);

  // Re-score all evidence for this dispute
  const scores = items.map((i) => scoreEvidenceItem(i, items));
  scoreStore.set(disputeId, scores);

  return item;
}

export function getEvidenceScores(disputeId: string): EvidenceScore[] {
  return scoreStore.get(disputeId) || [];
}

export function computeDisputePriority(
  disputeId: string,
  createdAt: string,
  escrowAmount: number,
  config: AutomationConfig = DEFAULT_CONFIG,
): DisputePriority {
  const scores = scoreStore.get(disputeId) || [];
  const items = evidenceStore.get(disputeId) || [];

  // Average evidence score
  const avgEvidenceScore = scores.length > 0
    ? scores.reduce((sum, s) => sum + s.overallScore, 0) / scores.length
    : 0;

  // Age factor (newer disputes are higher priority)
  const ageHours = (Date.now() - Date.parse(createdAt)) / (1000 * 60 * 60);
  const ageFactor = Math.max(0, 100 - ageHours * 2);

  // Amount factor (higher amounts = higher priority)
  const amountFactor = Math.min(50, escrowAmount / 100);

  // Evidence strength
  let evidenceStrength: DisputePriority['evidenceStrength'];
  if (avgEvidenceScore >= 75) evidenceStrength = 'strong';
  else if (avgEvidenceScore >= 50) evidenceStrength = 'moderate';
  else if (avgEvidenceScore >= 25) evidenceStrength = 'weak';
  else evidenceStrength = 'insufficient';

  // Combined priority score
  const priorityScore = Math.round(
    avgEvidenceScore * 0.5 + ageFactor * 0.3 + amountFactor * 0.2
  );

  // Recommended action
  let recommendedAction: DisputePriority['recommendedAction'];
  if (
    priorityScore >= config.autoResolveThreshold &&
    items.length >= config.minEvidenceForAutoResolve &&
    ageHours <= config.maxAgeForAutoResolveHours
  ) {
    recommendedAction = 'auto_resolve';
  } else if (priorityScore >= config.fastTrackThreshold) {
    recommendedAction = 'fast_track';
  } else if (priorityScore <= config.escalateThreshold) {
    recommendedAction = 'escalate';
  } else {
    recommendedAction = 'standard';
  }

  // Estimated resolution time
  const estimatedResolutionHours = recommendedAction === 'auto_resolve'
    ? 1
    : recommendedAction === 'fast_track'
      ? 24
      : recommendedAction === 'standard'
        ? 72
        : 168;

  return {
    disputeId,
    priorityScore,
    recommendedAction,
    evidenceStrength,
    estimatedResolutionHours,
  };
}

export function getEvidenceForDispute(disputeId: string): EvidenceItem[] {
  return evidenceStore.get(disputeId) || [];
}

export function removeEvidence(disputeId: string, evidenceId: string): boolean {
  const items = evidenceStore.get(disputeId);
  if (!items) return false;

  const idx = items.findIndex((i) => i.id === evidenceId);
  if (idx === -1) return false;

  items.splice(idx, 1);
  evidenceStore.set(disputeId, items);

  // Re-score
  const scores = items.map((i) => scoreEvidenceItem(i, items));
  scoreStore.set(disputeId, scores);

  return true;
}

export function resetForTests(): void {
  evidenceStore.clear();
  scoreStore.clear();
}
