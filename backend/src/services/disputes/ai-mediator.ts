/**
 * AI-Powered Dispute Mediation Service
 *
 * Analyzes dispute evidence via NLP, classifies likely outcome, generates a
 * confidence-scored resolution recommendation, and auto-resolves high-confidence
 * cases while routing ambiguous ones to human mediators.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DisputeCategory =
  | 'service_not_delivered'
  | 'partial_delivery'
  | 'quality_issue'
  | 'unauthorized_charge'
  | 'duplicate_charge'
  | 'other';

export type ResolutionRecommendation =
  | 'full_refund'
  | 'partial_refund'
  | 'release_to_payee'
  | 'needs_human_review';

export interface DisputeEvidenceInput {
  id: string;
  description: string;
  fileUrl?: string;
  fileName?: string;
  submittedBy: string;
  timestamp: string;
}

export interface DisputeInput {
  id: string;
  description: string;
  category: DisputeCategory;
  amount: number;
  currency: string;
  evidence: DisputeEvidenceInput[];
  chatHistory?: string[];
  historicalOutcome?: ResolutionRecommendation;
}

export interface MediationResult {
  disputeId: string;
  recommendation: ResolutionRecommendation;
  confidenceScore: number; // 0–1
  reasoning: string;
  suggestedRefundAmount?: number;
  autoResolved: boolean;
  escalatedToHuman: boolean;
  aiSummary: string;
  processedAt: string;
}

export interface AIMediationLog {
  id: string;
  disputeId: string;
  recommendation: ResolutionRecommendation;
  confidenceScore: number;
  reasoning: string;
  autoResolved: boolean;
  escalatedToHuman: boolean;
  mediatorDecision?: ResolutionRecommendation;
  mediatorNote?: string;
  processedAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// In-memory store for mediation logs (replace with Prisma in production)
// ---------------------------------------------------------------------------

const mediationLogs = new Map<string, AIMediationLog>();

// ---------------------------------------------------------------------------
// NLP helpers
// ---------------------------------------------------------------------------

const FRAUD_SIGNALS = [
  'unauthorized',
  'i did not make',
  'stolen',
  'fraud',
  'never ordered',
  'card stolen',
  'hacked',
];

const NON_DELIVERY_SIGNALS = [
  'never received',
  'not delivered',
  'did not arrive',
  'no shipment',
  'tracking shows nothing',
  'not provided',
];

const QUALITY_SIGNALS = [
  'broken',
  'defective',
  'not as described',
  'poor quality',
  'damaged',
  'wrong item',
  'incomplete',
];

const DUPLICATE_SIGNALS = [
  'charged twice',
  'duplicate',
  'double charge',
  'billed twice',
];

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
}

function countSignalMatches(text: string, signals: string[]): number {
  return signals.reduce((acc, sig) => (text.includes(sig) ? acc + 1 : acc), 0);
}

function extractKeySignals(description: string, evidence: DisputeEvidenceInput[]) {
  const combinedText = normalizeText(
    [description, ...evidence.map((e) => e.description)].join(' ')
  );

  return {
    fraudMatches: countSignalMatches(combinedText, FRAUD_SIGNALS),
    nonDeliveryMatches: countSignalMatches(combinedText, NON_DELIVERY_SIGNALS),
    qualityMatches: countSignalMatches(combinedText, QUALITY_SIGNALS),
    duplicateMatches: countSignalMatches(combinedText, DUPLICATE_SIGNALS),
    evidenceCount: evidence.length,
    hasFileEvidence: evidence.some((e) => !!e.fileUrl),
  };
}

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

interface ClassificationResult {
  recommendation: ResolutionRecommendation;
  rawConfidence: number;
  reasoning: string;
  suggestedRefundFraction: number;
}

function classifyDispute(
  input: DisputeInput,
  signals: ReturnType<typeof extractKeySignals>
): ClassificationResult {
  const { fraudMatches, nonDeliveryMatches, qualityMatches, duplicateMatches, hasFileEvidence, evidenceCount } = signals;

  // Duplicate charge — nearly always refund
  if (input.category === 'duplicate_charge' || duplicateMatches >= 1) {
    return {
      recommendation: 'full_refund',
      rawConfidence: 0.93 + (evidenceCount > 0 ? 0.04 : 0),
      reasoning: 'Dispute indicates a duplicate charge. High confidence full refund warranted.',
      suggestedRefundFraction: 1,
    };
  }

  // Unauthorized charge / fraud
  if (input.category === 'unauthorized_charge' || fraudMatches >= 2) {
    const conf = 0.88 + (hasFileEvidence ? 0.06 : 0);
    return {
      recommendation: 'full_refund',
      rawConfidence: Math.min(conf, 0.97),
      reasoning: 'Multiple fraud signals detected. Recommend full refund pending identity verification.',
      suggestedRefundFraction: 1,
    };
  }

  // Non-delivery
  if (input.category === 'service_not_delivered' || nonDeliveryMatches >= 2) {
    const conf = 0.82 + (hasFileEvidence ? 0.1 : 0);
    return {
      recommendation: conf >= 0.95 ? 'full_refund' : 'needs_human_review',
      rawConfidence: conf,
      reasoning: 'Non-delivery signals present. File evidence strengthens buyer claim.',
      suggestedRefundFraction: 1,
    };
  }

  // Quality issue — partial refund common
  if (input.category === 'quality_issue' || qualityMatches >= 1) {
    const conf = 0.72 + (hasFileEvidence ? 0.12 : 0) + (evidenceCount > 1 ? 0.05 : 0);
    return {
      recommendation: conf >= 0.95 ? 'partial_refund' : 'needs_human_review',
      rawConfidence: conf,
      reasoning: 'Quality issue reported. Partial refund likely; human review may be needed.',
      suggestedRefundFraction: 0.5,
    };
  }

  // Partial delivery
  if (input.category === 'partial_delivery') {
    return {
      recommendation: 'partial_refund',
      rawConfidence: 0.78,
      reasoning: 'Partial delivery claim — proportional refund suggested.',
      suggestedRefundFraction: 0.5,
    };
  }

  // Release to payee (merchant wins)
  if (evidenceCount === 0 && input.chatHistory && input.chatHistory.length === 0) {
    return {
      recommendation: 'release_to_payee',
      rawConfidence: 0.65,
      reasoning: 'No buyer evidence provided and no chat history. Tentatively favour payee.',
      suggestedRefundFraction: 0,
    };
  }

  // Default: needs human review
  return {
    recommendation: 'needs_human_review',
    rawConfidence: 0.45,
    reasoning: 'Insufficient signals for automated resolution. Escalating to human mediator.',
    suggestedRefundFraction: 0,
  };
}

// ---------------------------------------------------------------------------
// Historical pattern boost
// ---------------------------------------------------------------------------

function applyHistoricalBoost(
  result: ClassificationResult,
  historicalOutcome?: ResolutionRecommendation
): ClassificationResult {
  if (!historicalOutcome || historicalOutcome !== result.recommendation) return result;

  return {
    ...result,
    rawConfidence: Math.min(result.rawConfidence + 0.05, 0.99),
    reasoning: result.reasoning + ' Historical pattern confirms this resolution type.',
  };
}

// ---------------------------------------------------------------------------
// Summary generation
// ---------------------------------------------------------------------------

function generateSummary(input: DisputeInput, result: ClassificationResult): string {
  const lines: string[] = [
    `Dispute ID: ${input.id}`,
    `Category: ${input.category}`,
    `Amount: ${input.currency} ${input.amount.toFixed(2)}`,
    `Evidence items: ${input.evidence.length}`,
    `Recommendation: ${result.recommendation}`,
    `Confidence: ${(result.rawConfidence * 100).toFixed(1)}%`,
    `Reasoning: ${result.reasoning}`,
  ];

  if (result.recommendation === 'partial_refund') {
    lines.push(
      `Suggested refund: ${input.currency} ${(input.amount * result.suggestedRefundFraction).toFixed(2)}`
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const AUTO_RESOLVE_THRESHOLD = 0.95;

export async function analyzeDispute(input: DisputeInput): Promise<MediationResult> {
  const signals = extractKeySignals(input.description, input.evidence);
  let classification = classifyDispute(input, signals);
  classification = applyHistoricalBoost(classification, input.historicalOutcome);

  const autoResolved =
    classification.rawConfidence >= AUTO_RESOLVE_THRESHOLD &&
    classification.recommendation !== 'needs_human_review';

  const escalatedToHuman = !autoResolved;

  const suggestedRefundAmount =
    classification.recommendation === 'full_refund'
      ? input.amount
      : classification.recommendation === 'partial_refund'
      ? input.amount * classification.suggestedRefundFraction
      : undefined;

  const result: MediationResult = {
    disputeId: input.id,
    recommendation: classification.recommendation,
    confidenceScore: classification.rawConfidence,
    reasoning: classification.reasoning,
    suggestedRefundAmount,
    autoResolved,
    escalatedToHuman,
    aiSummary: generateSummary(input, classification),
    processedAt: new Date().toISOString(),
  };

  // Persist log
  const log: AIMediationLog = {
    id: randomUUID(),
    disputeId: input.id,
    recommendation: result.recommendation,
    confidenceScore: result.confidenceScore,
    reasoning: result.reasoning,
    autoResolved,
    escalatedToHuman,
    processedAt: result.processedAt,
    updatedAt: result.processedAt,
  };
  mediationLogs.set(log.id, log);

  return result;
}

export async function recordMediatorDecision(
  disputeId: string,
  decision: ResolutionRecommendation,
  note: string
): Promise<AIMediationLog | null> {
  for (const log of mediationLogs.values()) {
    if (log.disputeId === disputeId) {
      log.mediatorDecision = decision;
      log.mediatorNote = note;
      log.updatedAt = new Date().toISOString();
      return log;
    }
  }
  return null;
}

export function getMediationLog(disputeId: string): AIMediationLog | undefined {
  for (const log of mediationLogs.values()) {
    if (log.disputeId === disputeId) return log;
  }
  return undefined;
}

export function getAllMediationLogs(): AIMediationLog[] {
  return Array.from(mediationLogs.values());
}
