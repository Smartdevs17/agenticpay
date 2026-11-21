// dispute-resolution-service.ts — Issue #641
//
// Orchestrates structured payment dispute resolution: open → respond →
// evidence → escalate / assign arbitrator → resolve, with resolution
// tracking, dispute notifications, and analytics.
//
// Follows the same DB-optional pattern as payment-reconciliation: when
// DATABASE_URL is unset (this repo's default test run) everything lives in
// in-memory maps so the full workflow is unit-testable without Postgres.
// Call `resetForTests()` between tests.

import { createHash, randomUUID } from 'node:crypto';
import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import {
  ALL_STATUSES,
  VALID_OUTCOMES,
  VALID_REASONS,
  canTransition,
  computeDeadlines,
  isTerminal,
  nextStatus,
  shouldAutoEscalate,
  statusForOutcome,
  type DisputeEvent,
  type DisputeReason,
  type DisputeStatus,
  type ResolutionOutcome,
} from './workflow-engine.js';

// ─── Public DTO types ────────────────────────────────────────────────────────

export interface EvidenceDTO {
  id: string;
  disputeId: string;
  submittedBy: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  description: string;
  timestamp: string;
  hash: string;
}

export interface DisputeMessageDTO {
  id: string;
  disputeId: string;
  senderId: string;
  senderRole: 'payer' | 'payee' | 'arbitrator' | 'system';
  content: string;
  timestamp: string;
}

export interface ResolutionRecordDTO {
  id: string;
  disputeId: string;
  outcome: ResolutionOutcome;
  resolutionNote: string;
  refundAmount: number | null;
  resolvedBy: string;
  resolvedByRole: 'arbitrator' | 'system' | 'admin';
  createdAt: string;
}

export interface TimelineEventDTO {
  id: string;
  disputeId: string;
  event: DisputeEvent | 'created' | 'notified' | 'evidence_removed';
  actorId: string;
  detail: string;
  fromStatus: DisputeStatus | null;
  toStatus: DisputeStatus | null;
  createdAt: string;
}

export interface DisputeNotificationDTO {
  id: string;
  disputeId: string;
  recipientId: string;
  channel: 'email' | 'push' | 'in-app' | 'webhook';
  templateId: string;
  subject: string;
  body: string;
  createdAt: string;
  delivered: boolean;
}

export interface DisputeDTO {
  id: string;
  tenantId: string;
  paymentId: string;
  projectId: string | null;
  invoiceId: string | null;
  filedBy: string;
  respondentId: string;
  arbitratorId: string | null;
  status: DisputeStatus;
  reason: DisputeReason;
  amount: number;
  currency: string;
  description: string;
  resolution: ResolutionOutcome | null;
  resolutionNote: string | null;
  refundAmount: number | null;
  responseDeadline: string;
  escalationDeadline: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface DisputeDetail extends DisputeDTO {
  evidence: EvidenceDTO[];
  messages: DisputeMessageDTO[];
  resolutions: ResolutionRecordDTO[];
  timeline: TimelineEventDTO[];
  notifications: DisputeNotificationDTO[];
}

export interface CreateDisputeInput {
  tenantId: string;
  paymentId: string;
  filedBy: string;
  respondentId: string;
  reason: DisputeReason;
  amount: number;
  currency: string;
  description: string;
  projectId?: string;
  invoiceId?: string;
}

export interface RespondInput {
  senderId: string;
  senderRole: 'payer' | 'payee' | 'arbitrator';
  content: string;
}

export interface AddEvidenceInput {
  submittedBy: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  description: string;
  /** Optional precomputed content for hashing (falls back to metadata). */
  contentBytes?: string | Buffer;
}

export interface ResolveInput {
  outcome: ResolutionOutcome;
  resolutionNote: string;
  resolvedBy: string;
  resolvedByRole?: 'arbitrator' | 'system' | 'admin';
  refundAmount?: number;
}

export interface ListDisputesParams {
  tenantId?: string;
  status?: DisputeStatus;
  filedBy?: string;
  respondentId?: string;
  arbitratorId?: string;
  paymentId?: string;
}

export interface DisputeAnalytics {
  tenantId: string | null;
  total: number;
  openCount: number;
  resolvedCount: number;
  dismissedCount: number;
  escalatedCount: number;
  byStatus: Record<DisputeStatus, number>;
  byReason: Record<DisputeReason, number>;
  byOutcome: Partial<Record<ResolutionOutcome, number>>;
  averageResolutionHours: number | null;
  escalationRatePct: number;
  totalRefunded: number;
  evidenceCount: number;
  notificationCount: number;
  slaBreachCount: number;
  generatedAt: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

function emptyStatusCounts(): Record<DisputeStatus, number> {
  return Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<DisputeStatus, number>;
}

function emptyReasonCounts(): Record<DisputeReason, number> {
  return Object.fromEntries(VALID_REASONS.map((r) => [r, 0])) as Record<DisputeReason, number>;
}

function hashEvidence(payload: string | Buffer): string {
  return createHash('sha256').update(payload).digest('hex');
}

class DisputeResolutionService extends BaseService {
  private memDisputes = new Map<string, DisputeDTO>();
  private memEvidence = new Map<string, EvidenceDTO>();
  private memMessages = new Map<string, DisputeMessageDTO>();
  private memResolutions = new Map<string, ResolutionRecordDTO>();
  private memTimeline = new Map<string, TimelineEventDTO>();
  private memNotifications = new Map<string, DisputeNotificationDTO>();

  /** Clear in-memory state between unit tests. */
  resetForTests(): void {
    this.memDisputes.clear();
    this.memEvidence.clear();
    this.memMessages.clear();
    this.memResolutions.clear();
    this.memTimeline.clear();
    this.memNotifications.clear();
  }

  /** Test helper: overwrite SLA deadlines without going through create. */
  setDeadlinesForTests(id: string, responseDeadline: string, escalationDeadline: string): void {
    const dispute = this.memDisputes.get(id);
    if (!dispute) throw new Error(`Dispute not found: ${id}`);
    dispute.responseDeadline = responseDeadline;
    dispute.escalationDeadline = escalationDeadline;
  }

  // ── Create / read ────────────────────────────────────────────────────────

  async createDispute(input: CreateDisputeInput): Promise<Result<DisputeDetail>> {
    if (!input.tenantId?.trim()) return this.validationFailure('tenantId is required');
    if (!input.paymentId?.trim()) return this.validationFailure('paymentId is required');
    if (!input.filedBy?.trim()) return this.validationFailure('filedBy is required');
    if (!input.respondentId?.trim()) return this.validationFailure('respondentId is required');
    if (input.filedBy === input.respondentId) {
      return this.validationFailure('filedBy and respondentId must differ');
    }
    if (!VALID_REASONS.includes(input.reason)) {
      return this.validationFailure(`reason must be one of ${VALID_REASONS.join(', ')}`);
    }
    if (typeof input.amount !== 'number' || !(input.amount > 0)) {
      return this.validationFailure('amount must be a positive number');
    }
    if (!input.currency?.trim()) return this.validationFailure('currency is required');
    if (!input.description || input.description.trim().length < 20) {
      return this.validationFailure('description must be at least 20 characters');
    }

    const active = [...this.memDisputes.values()].find(
      (d) =>
        d.paymentId === input.paymentId &&
        !isTerminal(d.status) &&
        d.status !== 'dismissed',
    );
    if (active) {
      return this.conflictFailure(`Active dispute already exists for payment ${input.paymentId}`);
    }

    const now = new Date();
    const deadlines = computeDeadlines(now);
    const id = randomUUID();
    const dispute: DisputeDTO = {
      id,
      tenantId: input.tenantId,
      paymentId: input.paymentId,
      projectId: input.projectId ?? null,
      invoiceId: input.invoiceId ?? null,
      filedBy: input.filedBy,
      respondentId: input.respondentId,
      arbitratorId: null,
      status: 'awaiting_response',
      reason: input.reason,
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      description: input.description.trim(),
      resolution: null,
      resolutionNote: null,
      refundAmount: null,
      responseDeadline: deadlines.responseDeadline,
      escalationDeadline: deadlines.escalationDeadline,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      resolvedAt: null,
    };

    this.memDisputes.set(id, dispute);
    this.pushTimeline(id, 'created', input.filedBy, 'Dispute opened', null, 'awaiting_response');

    await this.notify(
      dispute,
      input.respondentId,
      'dispute_opened',
      'New payment dispute filed',
      `A dispute was filed on payment ${input.paymentId}: ${input.reason}`,
    );
    await this.notify(
      dispute,
      input.filedBy,
      'dispute_opened_ack',
      'Dispute submitted',
      `Your dispute ${id} is awaiting a response (deadline ${deadlines.responseDeadline}).`,
    );

    return this.ok(this.toDetail(dispute));
  }

  getDispute(id: string): Result<DisputeDetail> {
    const dispute = this.memDisputes.get(id);
    if (!dispute) return this.notFoundFailure('Dispute', id);
    return this.ok(this.toDetail(dispute));
  }

  listDisputes(params: ListDisputesParams = {}): Result<DisputeDTO[]> {
    let rows = [...this.memDisputes.values()];
    if (params.tenantId) rows = rows.filter((d) => d.tenantId === params.tenantId);
    if (params.status) rows = rows.filter((d) => d.status === params.status);
    if (params.filedBy) rows = rows.filter((d) => d.filedBy === params.filedBy);
    if (params.respondentId) rows = rows.filter((d) => d.respondentId === params.respondentId);
    if (params.arbitratorId) rows = rows.filter((d) => d.arbitratorId === params.arbitratorId);
    if (params.paymentId) rows = rows.filter((d) => d.paymentId === params.paymentId);
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return this.ok(rows);
  }

  // ── Workflow actions ─────────────────────────────────────────────────────

  async respond(id: string, input: RespondInput): Promise<Result<DisputeDetail>> {
    const dispute = this.memDisputes.get(id);
    if (!dispute) return this.notFoundFailure('Dispute', id);
    if (!input.content?.trim() || input.content.trim().length < 5) {
      return this.validationFailure('content must be at least 5 characters');
    }
    if (!canTransition(dispute.status, 'respond')) {
      return this.fail(`Cannot respond while dispute is ${dispute.status}`, 409, 'INVALID_TRANSITION');
    }

    const from = dispute.status;
    const to = nextStatus(from, 'respond');
    dispute.status = to;
    dispute.updatedAt = new Date().toISOString();

    const message: DisputeMessageDTO = {
      id: randomUUID(),
      disputeId: id,
      senderId: input.senderId,
      senderRole: input.senderRole,
      content: input.content.trim(),
      timestamp: new Date().toISOString(),
    };
    this.memMessages.set(message.id, message);
    this.pushTimeline(id, 'respond', input.senderId, 'Party response recorded', from, to);

    const notifyTarget = input.senderId === dispute.filedBy ? dispute.respondentId : dispute.filedBy;
    await this.notify(
      dispute,
      notifyTarget,
      'dispute_response',
      'Dispute response received',
      `A response was posted on dispute ${id}.`,
    );

    return this.ok(this.toDetail(dispute));
  }

  async addEvidence(id: string, input: AddEvidenceInput): Promise<Result<EvidenceDTO>> {
    const dispute = this.memDisputes.get(id);
    if (!dispute) return this.notFoundFailure('Dispute', id);
    if (!canTransition(dispute.status, 'add_evidence')) {
      return this.fail(`Cannot add evidence while dispute is ${dispute.status}`, 409, 'INVALID_TRANSITION');
    }
    if (!input.fileUrl?.trim()) return this.validationFailure('fileUrl is required');
    if (!input.fileName?.trim()) return this.validationFailure('fileName is required');
    if (!input.fileType?.trim()) return this.validationFailure('fileType is required');
    if (typeof input.fileSize !== 'number' || input.fileSize < 0) {
      return this.validationFailure('fileSize must be a non-negative number');
    }
    if (!input.submittedBy?.trim()) return this.validationFailure('submittedBy is required');

    const hashSource =
      input.contentBytes ??
      `${input.fileUrl}|${input.fileName}|${input.fileSize}|${input.submittedBy}|${Date.now()}`;
    const evidence: EvidenceDTO = {
      id: randomUUID(),
      disputeId: id,
      submittedBy: input.submittedBy,
      fileUrl: input.fileUrl,
      fileName: input.fileName,
      fileType: input.fileType,
      fileSize: input.fileSize,
      description: (input.description ?? '').trim(),
      timestamp: new Date().toISOString(),
      hash: hashEvidence(hashSource),
    };

    this.memEvidence.set(evidence.id, evidence);
    const from = dispute.status;
    dispute.status = nextStatus(from, 'add_evidence');
    dispute.updatedAt = new Date().toISOString();
    this.pushTimeline(
      id,
      'add_evidence',
      input.submittedBy,
      `Evidence uploaded: ${evidence.fileName} (${evidence.hash.slice(0, 12)}…)`,
      from,
      dispute.status,
    );

    const peers = [dispute.filedBy, dispute.respondentId, dispute.arbitratorId].filter(
      (uid): uid is string => Boolean(uid) && uid !== input.submittedBy,
    );
    for (const recipientId of peers) {
      await this.notify(
        dispute,
        recipientId,
        'dispute_evidence',
        'New dispute evidence',
        `Evidence "${evidence.fileName}" was added to dispute ${id}.`,
      );
    }

    return this.ok(evidence);
  }

  listEvidence(disputeId: string): Result<EvidenceDTO[]> {
    if (!this.memDisputes.has(disputeId)) return this.notFoundFailure('Dispute', disputeId);
    const rows = [...this.memEvidence.values()]
      .filter((e) => e.disputeId === disputeId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return this.ok(rows);
  }

  async removeEvidence(disputeId: string, evidenceId: string, actorId: string): Promise<Result<DisputeDetail>> {
    const dispute = this.memDisputes.get(disputeId);
    if (!dispute) return this.notFoundFailure('Dispute', disputeId);
    if (isTerminal(dispute.status)) {
      return this.fail('Cannot remove evidence from a closed dispute', 409, 'INVALID_TRANSITION');
    }
    const evidence = this.memEvidence.get(evidenceId);
    if (!evidence || evidence.disputeId !== disputeId) {
      return this.notFoundFailure('Evidence', evidenceId);
    }
    this.memEvidence.delete(evidenceId);
    dispute.updatedAt = new Date().toISOString();
    this.pushTimeline(
      disputeId,
      'evidence_removed',
      actorId,
      `Evidence removed: ${evidence.fileName}`,
      dispute.status,
      dispute.status,
    );
    return this.ok(this.toDetail(dispute));
  }

  async assignArbitrator(id: string, arbitratorId: string, actorId: string): Promise<Result<DisputeDetail>> {
    const dispute = this.memDisputes.get(id);
    if (!dispute) return this.notFoundFailure('Dispute', id);
    if (!arbitratorId?.trim()) return this.validationFailure('arbitratorId is required');
    if (!canTransition(dispute.status, 'assign_arbitrator')) {
      return this.fail(`Cannot assign arbitrator while dispute is ${dispute.status}`, 409, 'INVALID_TRANSITION');
    }

    const from = dispute.status;
    const to = nextStatus(from, 'assign_arbitrator');
    dispute.arbitratorId = arbitratorId;
    dispute.status = to;
    dispute.updatedAt = new Date().toISOString();
    this.pushTimeline(id, 'assign_arbitrator', actorId, `Arbitrator ${arbitratorId} assigned`, from, to);

    await this.notify(
      dispute,
      arbitratorId,
      'dispute_assigned',
      'Dispute assigned to you',
      `You were assigned as arbitrator on dispute ${id}.`,
    );

    return this.ok(this.toDetail(dispute));
  }

  async escalate(id: string, actorId = 'system', note = 'SLA escalation'): Promise<Result<DisputeDetail>> {
    const dispute = this.memDisputes.get(id);
    if (!dispute) return this.notFoundFailure('Dispute', id);
    if (!canTransition(dispute.status, 'escalate')) {
      return this.fail(`Cannot escalate while dispute is ${dispute.status}`, 409, 'INVALID_TRANSITION');
    }
    const from = dispute.status;
    const to = nextStatus(from, 'escalate');
    dispute.status = to;
    dispute.updatedAt = new Date().toISOString();
    this.pushTimeline(id, 'escalate', actorId, note, from, to);

    for (const recipientId of [dispute.filedBy, dispute.respondentId]) {
      await this.notify(
        dispute,
        recipientId,
        'dispute_escalated',
        'Dispute escalated',
        `Dispute ${id} was escalated: ${note}`,
      );
    }

    return this.ok(this.toDetail(dispute));
  }

  async resolve(id: string, input: ResolveInput): Promise<Result<DisputeDetail>> {
    const dispute = this.memDisputes.get(id);
    if (!dispute) return this.notFoundFailure('Dispute', id);
    if (!VALID_OUTCOMES.includes(input.outcome)) {
      return this.validationFailure(`outcome must be one of ${VALID_OUTCOMES.join(', ')}`);
    }
    if (!input.resolutionNote?.trim() || input.resolutionNote.trim().length < 5) {
      return this.validationFailure('resolutionNote must be at least 5 characters');
    }
    if (!input.resolvedBy?.trim()) return this.validationFailure('resolvedBy is required');
    if (input.outcome === 'partial_refund') {
      if (typeof input.refundAmount !== 'number' || input.refundAmount <= 0 || input.refundAmount > dispute.amount) {
        return this.validationFailure('partial_refund requires refundAmount in (0, dispute.amount]');
      }
    }
    if (input.outcome === 'full_refund') {
      input.refundAmount = dispute.amount;
    }

    const event: DisputeEvent = input.outcome === 'dismissed' ? 'dismiss' : 'resolve';
    if (!canTransition(dispute.status, event)) {
      return this.fail(`Cannot resolve while dispute is ${dispute.status}`, 409, 'INVALID_TRANSITION');
    }

    const from = dispute.status;
    const to = statusForOutcome(input.outcome);
    const now = new Date().toISOString();
    dispute.status = to;
    dispute.resolution = input.outcome;
    dispute.resolutionNote = input.resolutionNote.trim();
    dispute.refundAmount = input.refundAmount ?? null;
    dispute.resolvedAt = now;
    dispute.updatedAt = now;

    const resolution: ResolutionRecordDTO = {
      id: randomUUID(),
      disputeId: id,
      outcome: input.outcome,
      resolutionNote: dispute.resolutionNote,
      refundAmount: dispute.refundAmount,
      resolvedBy: input.resolvedBy,
      resolvedByRole: input.resolvedByRole ?? 'arbitrator',
      createdAt: now,
    };
    this.memResolutions.set(resolution.id, resolution);
    this.pushTimeline(id, event, input.resolvedBy, `Resolved: ${input.outcome}`, from, to);

    for (const recipientId of [dispute.filedBy, dispute.respondentId]) {
      await this.notify(
        dispute,
        recipientId,
        'dispute_resolved',
        'Dispute resolved',
        `Dispute ${id} resolved with outcome ${input.outcome}.`,
      );
    }

    return this.ok(this.toDetail(dispute));
  }

  getTimeline(id: string): Result<TimelineEventDTO[]> {
    if (!this.memDisputes.has(id)) return this.notFoundFailure('Dispute', id);
    const rows = [...this.memTimeline.values()]
      .filter((e) => e.disputeId === id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return this.ok(rows);
  }

  getResolutions(id: string): Result<ResolutionRecordDTO[]> {
    if (!this.memDisputes.has(id)) return this.notFoundFailure('Dispute', id);
    const rows = [...this.memResolutions.values()]
      .filter((r) => r.disputeId === id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return this.ok(rows);
  }

  listNotifications(disputeId?: string): Result<DisputeNotificationDTO[]> {
    let rows = [...this.memNotifications.values()];
    if (disputeId) rows = rows.filter((n) => n.disputeId === disputeId);
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return this.ok(rows);
  }

  // ── Escalation cron ──────────────────────────────────────────────────────

  async processEscalations(now: Date = new Date()): Promise<Result<{ escalated: number; ids: string[] }>> {
    const ids: string[] = [];
    for (const dispute of this.memDisputes.values()) {
      if (
        shouldAutoEscalate(
          dispute.status,
          dispute.responseDeadline,
          dispute.escalationDeadline,
          now,
        )
      ) {
        const result = await this.escalate(dispute.id, 'system', 'Auto-escalated past SLA deadline');
        if (result.ok) ids.push(dispute.id);
      }
    }
    return this.ok({ escalated: ids.length, ids });
  }

  // ── Analytics ────────────────────────────────────────────────────────────

  getAnalytics(tenantId?: string, now: Date = new Date()): Result<DisputeAnalytics> {
    let rows = [...this.memDisputes.values()];
    if (tenantId) rows = rows.filter((d) => d.tenantId === tenantId);

    const byStatus = emptyStatusCounts();
    const byReason = emptyReasonCounts();
    const byOutcome: Partial<Record<ResolutionOutcome, number>> = {};
    let totalRefunded = 0;
    let slaBreachCount = 0;
    const resolutionHours: number[] = [];

    for (const d of rows) {
      byStatus[d.status] += 1;
      byReason[d.reason] += 1;
      if (d.resolution) byOutcome[d.resolution] = (byOutcome[d.resolution] ?? 0) + 1;
      if (typeof d.refundAmount === 'number') totalRefunded += d.refundAmount;
      if (d.resolvedAt) {
        const hours =
          (new Date(d.resolvedAt).getTime() - new Date(d.createdAt).getTime()) / 3_600_000;
        resolutionHours.push(hours);
      }
      if (
        !isTerminal(d.status) &&
        (new Date(d.responseDeadline) < now || new Date(d.escalationDeadline) < now)
      ) {
        slaBreachCount += 1;
      }
    }

    const evidenceCount = [...this.memEvidence.values()].filter((e) =>
      rows.some((d) => d.id === e.disputeId),
    ).length;
    const notificationCount = [...this.memNotifications.values()].filter((n) =>
      rows.some((d) => d.id === n.disputeId),
    ).length;

    const escalatedUnique = new Set(
      [...this.memTimeline.values()]
        .filter((t) => t.event === 'escalate' && rows.some((d) => d.id === t.disputeId))
        .map((t) => t.disputeId),
    ).size;

    const averageResolutionHours =
      resolutionHours.length === 0
        ? null
        : Math.round(
            (resolutionHours.reduce((a, b) => a + b, 0) / resolutionHours.length) * 100,
          ) / 100;

    return this.ok({
      tenantId: tenantId ?? null,
      total: rows.length,
      openCount: rows.filter((d) => !isTerminal(d.status)).length,
      resolvedCount: byStatus.resolved,
      dismissedCount: byStatus.dismissed,
      escalatedCount: byStatus.escalated,
      byStatus,
      byReason,
      byOutcome,
      averageResolutionHours,
      escalationRatePct: rows.length === 0 ? 0 : Math.round((escalatedUnique / rows.length) * 10_000) / 100,
      totalRefunded: Math.round(totalRefunded * 100) / 100,
      evidenceCount,
      notificationCount,
      slaBreachCount,
      generatedAt: now.toISOString(),
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private toDetail(dispute: DisputeDTO): DisputeDetail {
    return {
      ...dispute,
      evidence: [...this.memEvidence.values()]
        .filter((e) => e.disputeId === dispute.id)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      messages: [...this.memMessages.values()]
        .filter((m) => m.disputeId === dispute.id)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      resolutions: [...this.memResolutions.values()]
        .filter((r) => r.disputeId === dispute.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      timeline: [...this.memTimeline.values()]
        .filter((t) => t.disputeId === dispute.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      notifications: [...this.memNotifications.values()]
        .filter((n) => n.disputeId === dispute.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  }

  private pushTimeline(
    disputeId: string,
    event: TimelineEventDTO['event'],
    actorId: string,
    detail: string,
    fromStatus: DisputeStatus | null,
    toStatus: DisputeStatus | null,
  ): void {
    const row: TimelineEventDTO = {
      id: randomUUID(),
      disputeId,
      event,
      actorId,
      detail,
      fromStatus,
      toStatus,
      createdAt: new Date().toISOString(),
    };
    this.memTimeline.set(row.id, row);
  }

  private async notify(
    dispute: DisputeDTO,
    recipientId: string,
    templateId: string,
    subject: string,
    body: string,
  ): Promise<void> {
    const channels: DisputeNotificationDTO['channel'][] = ['email', 'push', 'in-app'];
    for (const channel of channels) {
      const n: DisputeNotificationDTO = {
        id: randomUUID(),
        disputeId: dispute.id,
        recipientId,
        channel,
        templateId,
        subject,
        body,
        createdAt: new Date().toISOString(),
        delivered: true,
      };
      this.memNotifications.set(n.id, n);
    }
    this.pushTimeline(dispute.id, 'notified', 'system', `${templateId} → ${recipientId}`, dispute.status, dispute.status);
  }
}

export const disputeResolutionService = new DisputeResolutionService();
export { DisputeResolutionService };
