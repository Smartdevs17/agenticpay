// workflow-engine.ts — Issue #641
//
// Pure, DB-free state machine for structured payment dispute resolution.
// Encodes legal transitions, SLA deadline helpers, and outcome → terminal
// status mapping so the orchestrating service stays free of branching logic.

export type DisputeStatus =
  | 'pending'
  | 'awaiting_response'
  | 'under_review'
  | 'resolved'
  | 'escalated'
  | 'dismissed';

export type DisputeReason =
  | 'service_not_delivered'
  | 'partial_delivery'
  | 'quality_issue'
  | 'unauthorized_charge'
  | 'duplicate_charge'
  | 'other';

export type ResolutionOutcome =
  | 'full_refund'
  | 'partial_refund'
  | 'release_to_payee'
  | 'dismissed'
  | 'pending';

export type DisputeEvent =
  | 'submit'
  | 'respond'
  | 'add_evidence'
  | 'escalate'
  | 'assign_arbitrator'
  | 'resolve'
  | 'dismiss';

/** Hours a respondent has to reply before auto-escalation. */
export const RESPONSE_SLA_HOURS = 72;
/** Hours from open until mandatory review-escalation if still open. */
export const ESCALATION_SLA_HOURS = 168;

const TRANSITIONS: Record<DisputeStatus, Partial<Record<DisputeEvent, DisputeStatus>>> = {
  pending: {
    submit: 'awaiting_response',
    dismiss: 'dismissed',
  },
  awaiting_response: {
    respond: 'under_review',
    add_evidence: 'awaiting_response',
    escalate: 'escalated',
    dismiss: 'dismissed',
  },
  under_review: {
    add_evidence: 'under_review',
    assign_arbitrator: 'under_review',
    escalate: 'escalated',
    resolve: 'resolved',
    dismiss: 'dismissed',
  },
  escalated: {
    add_evidence: 'escalated',
    assign_arbitrator: 'under_review',
    resolve: 'resolved',
    dismiss: 'dismissed',
  },
  resolved: {},
  dismissed: {},
};

export function canTransition(from: DisputeStatus, event: DisputeEvent): boolean {
  return Boolean(TRANSITIONS[from]?.[event]);
}

export function nextStatus(from: DisputeStatus, event: DisputeEvent): DisputeStatus {
  const to = TRANSITIONS[from]?.[event];
  if (!to) {
    throw new Error(`Illegal dispute transition: ${from} + ${event}`);
  }
  return to;
}

export function isTerminal(status: DisputeStatus): boolean {
  return status === 'resolved' || status === 'dismissed';
}

export function statusForOutcome(outcome: ResolutionOutcome): DisputeStatus {
  return outcome === 'dismissed' ? 'dismissed' : 'resolved';
}

export function addHoursIso(from: Date, hours: number): string {
  return new Date(from.getTime() + hours * 3_600_000).toISOString();
}

export function computeDeadlines(openedAt: Date = new Date()): {
  responseDeadline: string;
  escalationDeadline: string;
} {
  return {
    responseDeadline: addHoursIso(openedAt, RESPONSE_SLA_HOURS),
    escalationDeadline: addHoursIso(openedAt, ESCALATION_SLA_HOURS),
  };
}

/** Decide whether a dispute should auto-escalate under SLA rules. */
export function shouldAutoEscalate(
  status: DisputeStatus,
  responseDeadline: string,
  escalationDeadline: string,
  now: Date = new Date(),
): boolean {
  if (isTerminal(status) || status === 'escalated') return false;
  if (status === 'awaiting_response' && new Date(responseDeadline) < now) return true;
  if ((status === 'under_review' || status === 'pending') && new Date(escalationDeadline) < now) {
    return true;
  }
  return false;
}

export const VALID_REASONS: DisputeReason[] = [
  'service_not_delivered',
  'partial_delivery',
  'quality_issue',
  'unauthorized_charge',
  'duplicate_charge',
  'other',
];

export const VALID_OUTCOMES: ResolutionOutcome[] = [
  'full_refund',
  'partial_refund',
  'release_to_payee',
  'dismissed',
  'pending',
];

export const ALL_STATUSES: DisputeStatus[] = [
  'pending',
  'awaiting_response',
  'under_review',
  'resolved',
  'escalated',
  'dismissed',
];
