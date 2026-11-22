/**
 * disputeAutomation.ts — Issues #707, #1368
 *
 * Escrow dispute automation with an evidence scoring rubric.
 * Every evidence item is scored against a weighted rubric whose per-criterion
 * breakdown is kept alongside the score, so automated decisions can be
 * explained to both parties and to a human reviewer. `runDisputeAutomation`
 * turns the scores into a routing decision and records it in a decision log.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type EvidenceType = 'document' | 'screenshot' | 'transaction_proof' | 'communication' | 'other';

export const EVIDENCE_TYPES: readonly EvidenceType[] = [
  'document',
  'screenshot',
  'transaction_proof',
  'communication',
  'other',
];

export interface EvidenceItem {
  id: string;
  disputeId: string;
  type: EvidenceType;
  url: string;
  description: string;
  submittedBy: string;
  submittedAt: string;
}

export type RubricCriterionId = 'relevance' | 'credibility' | 'completeness';

export interface RubricCriterionResult {
  criterion: RubricCriterionId;
  score: number;   // 0-100
  weight: number;  // share of the overall score, all weights sum to 1
  reason: string;
}

export interface EvidenceScore {
  evidenceId: string;
  relevanceScore: number;    // 0-100
  credibilityScore: number;  // 0-100
  completenessScore: number; // 0-100
  overallScore: number;      // weighted by the rubric
  breakdown: RubricCriterionResult[];
  rubricVersion: string;
  flags: string[];
}

export interface EvidenceRubric {
  version: string;
  weights: Record<RubricCriterionId, number>;
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

export interface AutomationDecision extends DisputePriority {
  decisionId: string;
  evidenceCount: number;
  averageEvidenceScore: number;
  rubricVersion: string;
  reasons: string[];
  decidedAt: string;
}

export interface RunAutomationInput {
  disputeId: string;
  createdAt: string;
  escrowAmount: number;
}

/** Same shape as `observability/datadog.ts` `metrics`, so it can be passed in directly. */
export interface DisputeAutomationMetrics {
  increment(metric: string, value: number, tags: Record<string, string>): void;
  gauge(metric: string, value: number, tags: Record<string, string>): void;
}

const noopMetrics: DisputeAutomationMetrics = { increment: () => {}, gauge: () => {} };
let metricsSink: DisputeAutomationMetrics = noopMetrics;

/** Route automation metrics to a backend such as StatsD. Pass null to disable. */
export function setDisputeAutomationMetrics(sink: DisputeAutomationMetrics | null): void {
  metricsSink = sink ?? noopMetrics;
}

export class DisputeAutomationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DisputeAutomationError';
  }
}

const DEFAULT_CONFIG: AutomationConfig = {
  autoResolveThreshold: 85,
  fastTrackThreshold: 70,
  escalateThreshold: 30,
  minEvidenceForAutoResolve: 2,
  maxAgeForAutoResolveHours: 48,
};

export const DEFAULT_EVIDENCE_RUBRIC: EvidenceRubric = {
  version: '2026-11',
  weights: { relevance: 0.4, credibility: 0.35, completeness: 0.25 },
};

const ALLOWED_URL_PROTOCOLS = new Set(['https:', 'http:', 'ipfs:']);

// ─── Store ───────────────────────────────────────────────────────────────────

const evidenceStore = new Map<string, EvidenceItem[]>();
const scoreStore = new Map<string, EvidenceScore[]>();
const decisionStore = new Map<string, AutomationDecision[]>();

// ─── Validation ──────────────────────────────────────────────────────────────

function assertRubric(rubric: EvidenceRubric): void {
  const weights = Object.values(rubric.weights);
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new DisputeAutomationError('Rubric weights must be non-negative numbers');
  }
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (Math.abs(total - 1) > 1e-6) {
    throw new DisputeAutomationError(`Rubric weights must sum to 1, got ${total}`);
  }
}

function assertConfig(config: AutomationConfig): void {
  const { autoResolveThreshold, fastTrackThreshold, escalateThreshold } = config;
  if (!(escalateThreshold < fastTrackThreshold && fastTrackThreshold <= autoResolveThreshold)) {
    throw new DisputeAutomationError(
      'Thresholds must satisfy escalateThreshold < fastTrackThreshold <= autoResolveThreshold',
    );
  }
}

function assertEvidenceInput(disputeId: string, type: EvidenceType, url: string, submittedBy: string): void {
  if (!disputeId.trim()) throw new DisputeAutomationError('disputeId is required');
  if (!submittedBy.trim()) throw new DisputeAutomationError('submittedBy is required');
  if (!EVIDENCE_TYPES.includes(type)) throw new DisputeAutomationError(`Unknown evidence type: ${type}`);
  if (url) {
    let protocol: string;
    try {
      protocol = new URL(url).protocol;
    } catch {
      throw new DisputeAutomationError(`Evidence url is not a valid URL: ${url}`);
    }
    if (!ALLOWED_URL_PROTOCOLS.has(protocol)) {
      throw new DisputeAutomationError(`Evidence url protocol ${protocol} is not allowed`);
    }
  }
}

// ─── Evidence Scoring ────────────────────────────────────────────────────────

const TYPE_WEIGHTS: Record<EvidenceType, number> = {
  transaction_proof: 1.0,
  document: 0.9,
  screenshot: 0.7,
  communication: 0.6,
  other: 0.4,
};

function scoreEvidenceItem(
  item: EvidenceItem,
  allItems: EvidenceItem[],
  rubric: EvidenceRubric = DEFAULT_EVIDENCE_RUBRIC,
): EvidenceScore {
  const relevanceScore = Math.round(TYPE_WEIGHTS[item.type] * 100);

  const hasDescription = item.description.length > 20;
  const duplicateCount = allItems.filter(
    (i) => i.type === item.type && i.submittedBy === item.submittedBy
  ).length;
  const credibilityScore = Math.max(0, Math.min(100,
    (hasDescription ? 70 : 40) - (duplicateCount > 1 ? 10 : 0)
  ));

  const completenessScore = item.url ? 80 : 40;

  const breakdown: RubricCriterionResult[] = [
    {
      criterion: 'relevance',
      score: relevanceScore,
      weight: rubric.weights.relevance,
      reason: `${item.type} evidence carries a type weight of ${TYPE_WEIGHTS[item.type]}`,
    },
    {
      criterion: 'credibility',
      score: credibilityScore,
      weight: rubric.weights.credibility,
      reason: [
        hasDescription ? 'detailed description' : 'description of 20 characters or fewer',
        duplicateCount > 1 ? `${duplicateCount} items of this type from the same party` : null,
      ].filter(Boolean).join(', '),
    },
    {
      criterion: 'completeness',
      score: completenessScore,
      weight: rubric.weights.completeness,
      reason: item.url ? 'supporting file or link attached' : 'no supporting file or link',
    },
  ];

  const overallScore = Math.round(breakdown.reduce((sum, c) => sum + c.score * c.weight, 0));

  const flags: string[] = [];
  if (duplicateCount > 1) flags.push('repeated_submission_type');
  if (!hasDescription) flags.push('vague_description');
  if (!item.url) flags.push('missing_attachment');

  return {
    evidenceId: item.id,
    relevanceScore,
    credibilityScore,
    completenessScore,
    overallScore,
    breakdown,
    rubricVersion: rubric.version,
    flags,
  };
}

function rescore(disputeId: string, items: EvidenceItem[]): void {
  scoreStore.set(disputeId, items.map((i) => scoreEvidenceItem(i, items)));
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Score evidence against a custom rubric without touching the stored scores. */
export function scoreEvidenceWithRubric(disputeId: string, rubric: EvidenceRubric): EvidenceScore[] {
  assertRubric(rubric);
  const items = evidenceStore.get(disputeId) || [];
  return items.map((i) => scoreEvidenceItem(i, items, rubric));
}

export function addEvidence(
  disputeId: string,
  type: EvidenceType,
  url: string,
  description: string,
  submittedBy: string,
): EvidenceItem {
  assertEvidenceInput(disputeId, type, url, submittedBy);

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
  rescore(disputeId, items);

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
  assertConfig(config);
  const createdAtMs = Date.parse(createdAt);
  if (Number.isNaN(createdAtMs)) throw new DisputeAutomationError(`Invalid createdAt: ${createdAt}`);
  if (!Number.isFinite(escrowAmount) || escrowAmount < 0) {
    throw new DisputeAutomationError(`Invalid escrowAmount: ${escrowAmount}`);
  }

  const scores = scoreStore.get(disputeId) || [];
  const items = evidenceStore.get(disputeId) || [];

  const avgEvidenceScore = scores.length > 0
    ? scores.reduce((sum, s) => sum + s.overallScore, 0) / scores.length
    : 0;

  // Newer disputes are higher priority. A createdAt in the future counts as brand new.
  const ageHours = Math.max(0, (Date.now() - createdAtMs) / (1000 * 60 * 60));
  const ageFactor = Math.max(0, 100 - ageHours * 2);

  const amountFactor = Math.min(50, escrowAmount / 100);

  let evidenceStrength: DisputePriority['evidenceStrength'];
  if (avgEvidenceScore >= 75) evidenceStrength = 'strong';
  else if (avgEvidenceScore >= 50) evidenceStrength = 'moderate';
  else if (avgEvidenceScore >= 25) evidenceStrength = 'weak';
  else evidenceStrength = 'insufficient';

  const priorityScore = Math.round(
    avgEvidenceScore * 0.5 + ageFactor * 0.3 + amountFactor * 0.2
  );

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

/**
 * Score the dispute, pick a route, and record the decision with the reasons
 * behind it. Emits `dispute_automation.decision` and
 * `dispute_automation.priority_score` metrics plus a structured log line.
 */
export function runDisputeAutomation(
  input: RunAutomationInput,
  config: AutomationConfig = DEFAULT_CONFIG,
): AutomationDecision {
  const priority = computeDisputePriority(input.disputeId, input.createdAt, input.escrowAmount, config);
  const scores = getEvidenceScores(input.disputeId);
  const averageEvidenceScore = scores.length > 0
    ? Math.round(scores.reduce((sum, s) => sum + s.overallScore, 0) / scores.length)
    : 0;

  const reasons: string[] = [];
  if (scores.length === 0) reasons.push('no evidence submitted');
  else reasons.push(`${scores.length} evidence item(s), average rubric score ${averageEvidenceScore}`);
  if (scores.length > 0 && scores.length < config.minEvidenceForAutoResolve) {
    reasons.push(`fewer than ${config.minEvidenceForAutoResolve} items, auto-resolve not allowed`);
  }
  const flagged = new Set(scores.flatMap((s) => s.flags));
  if (flagged.size > 0) reasons.push(`evidence flags: ${[...flagged].sort().join(', ')}`);
  reasons.push(`priority score ${priority.priorityScore} routed to ${priority.recommendedAction}`);

  const decision: AutomationDecision = {
    ...priority,
    decisionId: `dad_${randomUUID().slice(0, 8)}`,
    evidenceCount: scores.length,
    averageEvidenceScore,
    rubricVersion: DEFAULT_EVIDENCE_RUBRIC.version,
    reasons,
    decidedAt: new Date().toISOString(),
  };

  const log = decisionStore.get(input.disputeId) || [];
  log.push(decision);
  decisionStore.set(input.disputeId, log);

  const tags = { action: decision.recommendedAction, strength: decision.evidenceStrength };
  metricsSink.increment('dispute_automation.decision', 1, tags);
  metricsSink.gauge('dispute_automation.priority_score', decision.priorityScore, tags);
  logger.info('[dispute-automation] decision', {
    disputeId: input.disputeId,
    decisionId: decision.decisionId,
    action: decision.recommendedAction,
    priorityScore: decision.priorityScore,
    evidenceCount: decision.evidenceCount,
  });

  return decision;
}

export function getAutomationDecisions(disputeId: string): AutomationDecision[] {
  return decisionStore.get(disputeId) || [];
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
  rescore(disputeId, items);

  return true;
}

export function resetForTests(): void {
  evidenceStore.clear();
  scoreStore.clear();
  decisionStore.clear();
}
