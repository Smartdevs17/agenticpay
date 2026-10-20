import { randomUUID } from 'node:crypto';

/**
 * Chargeback management with evidence submission (Issue #926).
 *
 * Full lifecycle for card/ACH chargebacks: intake, evidence submission with
 * deadlines, representment, and outcome tracking. State is held in memory,
 * matching the existing disputes / onboarding services, so the module is pure
 * and dependency-free.
 */

export type ChargebackStatus =
  | 'received'
  | 'under_review'
  | 'evidence_required'
  | 'evidence_submitted'
  | 'representment'
  | 'won'
  | 'lost'
  | 'accepted';

export type ChargebackReason =
  | 'fraudulent'
  | 'unrecognized'
  | 'product_not_received'
  | 'product_unacceptable'
  | 'duplicate_charge'
  | 'subscription_canceled'
  | 'credit_not_processed';

export type EvidenceType =
  | 'receipt'
  | 'tracking_number'
  | 'customer_communication'
  | 'refund_policy'
  | 'delivery_proof'
  | 'signature'
  | 'avs_cvv_match'
  | 'ip_location'
  | 'other';

export interface ChargebackEvidence {
  id: string;
  type: EvidenceType;
  description: string;
  /** Reference to an uploaded file / external resource. */
  fileUrl?: string;
  submittedBy: string;
  submittedAt: string;
}

export interface ChargebackEvent {
  id: string;
  type:
    | 'created'
    | 'status_changed'
    | 'evidence_submitted'
    | 'evidence_removed'
    | 'note_added';
  description: string;
  actor: string;
  at: string;
}

export interface Chargeback {
  id: string;
  merchantId: string;
  paymentId: string;
  customerId?: string;
  amount: number;
  currency: string;
  reason: ChargebackReason;
  status: ChargebackStatus;
  /** ISO timestamp by which evidence must be submitted. */
  evidenceDueBy: string;
  evidence: ChargebackEvidence[];
  notes: string[];
  timeline: ChargebackEvent[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface CreateChargebackInput {
  merchantId: string;
  paymentId: string;
  customerId?: string;
  amount: number;
  currency: string;
  reason: ChargebackReason;
  /** Days until the evidence deadline. Default 7. */
  evidenceWindowDays?: number;
}

export interface SubmitEvidenceInput {
  type: EvidenceType;
  description: string;
  fileUrl?: string;
  submittedBy: string;
}

const chargebacks = new Map<string, Chargeback>();

/** Valid status transitions for a chargeback case. */
const VALID_TRANSITIONS: Record<ChargebackStatus, ChargebackStatus[]> = {
  received: ['under_review', 'accepted', 'evidence_required', 'representment'],
  under_review: ['evidence_required', 'evidence_submitted', 'accepted', 'representment'],
  evidence_required: ['evidence_submitted', 'accepted', 'lost'],
  evidence_submitted: ['representment', 'won', 'lost'],
  representment: ['won', 'lost'],
  won: [],
  lost: [],
  accepted: [],
};

function nowIso(): string {
  return new Date().toISOString();
}

function addDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function pushEvent(
  chargeback: Chargeback,
  type: ChargebackEvent['type'],
  description: string,
  actor: string,
): void {
  chargeback.timeline.push({
    id: `cb_evt_${randomUUID()}`,
    type,
    description,
    actor,
    at: nowIso(),
  });
}

export function createChargeback(input: CreateChargebackInput): Chargeback {
  if (input.amount <= 0) {
    throw new Error('Chargeback amount must be greater than zero');
  }

  const id = `cb_${randomUUID()}`;
  const timestamp = nowIso();
  const chargeback: Chargeback = {
    id,
    merchantId: input.merchantId,
    paymentId: input.paymentId,
    customerId: input.customerId,
    amount: input.amount,
    currency: input.currency,
    reason: input.reason,
    status: 'received',
    evidenceDueBy: addDays(input.evidenceWindowDays ?? 7),
    evidence: [],
    notes: [],
    timeline: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  pushEvent(chargeback, 'created', `Chargeback received for ${input.reason}`, 'system');
  chargebacks.set(id, chargeback);
  return chargeback;
}

export function getChargeback(id: string): Chargeback | null {
  return chargebacks.get(id) ?? null;
}

export function listChargebacks(filter?: {
  merchantId?: string;
  status?: ChargebackStatus;
}): Chargeback[] {
  let all = Array.from(chargebacks.values());
  const merchantId = filter?.merchantId;
  const status = filter?.status;
  if (merchantId) all = all.filter((c) => c.merchantId === merchantId);
  if (status) all = all.filter((c) => c.status === status);
  return all;
}

export function updateChargebackStatus(
  id: string,
  status: ChargebackStatus,
  actor: string,
): Chargeback {
  const chargeback = chargebacks.get(id);
  if (!chargeback) throw new Error('Chargeback not found');

  const allowed = VALID_TRANSITIONS[chargeback.status];
  if (!allowed.includes(status)) {
    throw new Error(`Invalid status transition from ${chargeback.status} to ${status}`);
  }

  const previous = chargeback.status;
  chargeback.status = status;
  chargeback.updatedAt = nowIso();

  if (status === 'won' || status === 'lost' || status === 'accepted') {
    chargeback.resolvedAt = chargeback.updatedAt;
  }

  pushEvent(chargeback, 'status_changed', `Status changed from ${previous} to ${status}`, actor);
  return chargeback;
}

export function submitEvidence(id: string, input: SubmitEvidenceInput): Chargeback {
  const chargeback = chargebacks.get(id);
  if (!chargeback) throw new Error('Chargeback not found');

  if (chargeback.status === 'won' || chargeback.status === 'lost' || chargeback.status === 'accepted') {
    throw new Error('Cannot submit evidence for a closed chargeback');
  }

  if (isEvidenceWindowClosed(chargeback)) {
    throw new Error('Evidence submission deadline has passed');
  }

  const evidence: ChargebackEvidence = {
    id: `cb_ev_${randomUUID()}`,
    type: input.type,
    description: input.description,
    fileUrl: input.fileUrl,
    submittedBy: input.submittedBy,
    submittedAt: nowIso(),
  };

  chargeback.evidence.push(evidence);
  chargeback.status = 'evidence_submitted';
  chargeback.updatedAt = nowIso();

  pushEvent(
    chargeback,
    'evidence_submitted',
    `Evidence submitted: ${input.type}`,
    input.submittedBy,
  );
  return chargeback;
}

export function removeEvidence(id: string, evidenceId: string, actor: string): Chargeback {
  const chargeback = chargebacks.get(id);
  if (!chargeback) throw new Error('Chargeback not found');

  const index = chargeback.evidence.findIndex((e) => e.id === evidenceId);
  if (index === -1) throw new Error('Evidence not found');

  chargeback.evidence.splice(index, 1);
  chargeback.updatedAt = nowIso();
  pushEvent(chargeback, 'evidence_removed', `Evidence removed: ${evidenceId}`, actor);
  return chargeback;
}

export function addNote(id: string, note: string, actor: string): Chargeback {
  const chargeback = chargebacks.get(id);
  if (!chargeback) throw new Error('Chargeback not found');

  chargeback.notes.push(note);
  chargeback.updatedAt = nowIso();
  pushEvent(chargeback, 'note_added', note, actor);
  return chargeback;
}

export function isEvidenceWindowClosed(
  chargeback: Chargeback,
  at: Date = new Date(),
): boolean {
  return new Date(chargeback.evidenceDueBy).getTime() < at.getTime();
}

export interface ChargebackSummary {
  total: number;
  byStatus: Record<string, number>;
  disputedAmount: number;
  recoveredAmount: number;
  winRate: number;
}

export function summarizeChargebacks(merchantId?: string): ChargebackSummary {
  const cases = listChargebacks(merchantId ? { merchantId } : undefined);

  const byStatus: Record<string, number> = {};
  let disputedAmount = 0;
  let recoveredAmount = 0;
  let decided = 0;
  let won = 0;

  for (const c of cases) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    disputedAmount += c.amount;
    if (c.status === 'won' || c.status === 'lost') {
      decided++;
      if (c.status === 'won') {
        won++;
        recoveredAmount += c.amount;
      }
    }
  }

  return {
    total: cases.length,
    byStatus,
    disputedAmount: Number(disputedAmount.toFixed(2)),
    recoveredAmount: Number(recoveredAmount.toFixed(2)),
    winRate: decided > 0 ? Number(((won / decided) * 100).toFixed(2)) : 0,
  };
}

/** Test helper: clear all in-memory chargebacks. */
export function resetChargebacksForTests(): void {
  chargebacks.clear();
}
