// dispute-resolution.test.ts — Issue #641
//
// Unit tests for the dispute workflow engine and the dispute-resolution
// service (evidence, resolution tracking, notifications, analytics, SLA
// escalations). Runs without DATABASE_URL (in-memory fallback).

import { beforeEach, describe, expect, it } from 'vitest';
import {
  canTransition,
  nextStatus,
  shouldAutoEscalate,
  computeDeadlines,
  RESPONSE_SLA_HOURS,
} from '../dispute-resolution/workflow-engine.js';
import {
  DisputeResolutionService,
  type CreateDisputeInput,
} from '../dispute-resolution/dispute-resolution-service.js';

function baseCreate(overrides: Partial<CreateDisputeInput> = {}): CreateDisputeInput {
  return {
    tenantId: 'ten_1',
    paymentId: 'pay_1',
    filedBy: 'payer_1',
    respondentId: 'payee_1',
    reason: 'service_not_delivered',
    amount: 250,
    currency: 'USDC',
    description: 'Deliverable was never shipped after payment cleared escrow.',
    ...overrides,
  };
}

describe('workflow-engine', () => {
  it('allows respond from awaiting_response → under_review', () => {
    expect(canTransition('awaiting_response', 'respond')).toBe(true);
    expect(nextStatus('awaiting_response', 'respond')).toBe('under_review');
  });

  it('rejects resolve from awaiting_response', () => {
    expect(canTransition('awaiting_response', 'resolve')).toBe(false);
    expect(() => nextStatus('awaiting_response', 'resolve')).toThrow(/Illegal/);
  });

  it('auto-escalates awaiting_response past response deadline', () => {
    const opened = new Date('2026-07-01T00:00:00Z');
    const { responseDeadline, escalationDeadline } = computeDeadlines(opened);
    const afterSla = new Date(opened.getTime() + (RESPONSE_SLA_HOURS + 1) * 3_600_000);
    expect(shouldAutoEscalate('awaiting_response', responseDeadline, escalationDeadline, afterSla)).toBe(true);
    expect(shouldAutoEscalate('resolved', responseDeadline, escalationDeadline, afterSla)).toBe(false);
  });
});

describe('DisputeResolutionService', () => {
  let service: DisputeResolutionService;

  beforeEach(() => {
    service = new DisputeResolutionService();
    service.resetForTests();
  });

  it('creates a structured dispute with deadlines and notifications', async () => {
    const result = await service.createDispute(baseCreate());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe('awaiting_response');
    expect(result.value.responseDeadline).toBeTruthy();
    expect(result.value.escalationDeadline).toBeTruthy();
    expect(result.value.notifications.length).toBeGreaterThanOrEqual(6); // 2 recipients × 3 channels
    expect(result.value.timeline.some((t) => t.event === 'created')).toBe(true);
  });

  it('rejects active duplicate disputes on the same payment', async () => {
    const first = await service.createDispute(baseCreate());
    expect(first.ok).toBe(true);
    const second = await service.createDispute(baseCreate());
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.statusCode).toBe(409);
  });

  it('runs respond → evidence → resolve with resolution tracking', async () => {
    const created = await service.createDispute(baseCreate());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.id;

    const responded = await service.respond(id, {
      senderId: 'payee_1',
      senderRole: 'payee',
      content: 'Work was delivered on schedule via the agreed channel.',
    });
    expect(responded.ok).toBe(true);
    if (!responded.ok) return;
    expect(responded.value.status).toBe('under_review');
    expect(responded.value.messages).toHaveLength(1);

    const evidence = await service.addEvidence(id, {
      submittedBy: 'payee_1',
      fileUrl: 'https://cdn.example/proof.pdf',
      fileName: 'proof.pdf',
      fileType: 'application/pdf',
      fileSize: 12_345,
      description: 'Delivery receipt',
      contentBytes: 'receipt-bytes',
    });
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) return;
    expect(evidence.value.hash).toHaveLength(64);

    const listed = service.listEvidence(id);
    expect(listed.ok && listed.value).toHaveLength(1);

    const resolved = await service.resolve(id, {
      outcome: 'partial_refund',
      resolutionNote: 'Partial delivery confirmed; refund 40%.',
      resolvedBy: 'arb_1',
      refundAmount: 100,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.status).toBe('resolved');
    expect(resolved.value.resolution).toBe('partial_refund');
    expect(resolved.value.refundAmount).toBe(100);
    expect(resolved.value.resolutions).toHaveLength(1);
    expect(resolved.value.timeline.some((t) => t.event === 'resolve')).toBe(true);
  });

  it('tracks full_refund amount automatically', async () => {
    const created = await service.createDispute(baseCreate({ amount: 80 }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await service.respond(created.value.id, {
      senderId: 'payee_1',
      senderRole: 'payee',
      content: 'Unable to complete the remaining work.',
    });
    const resolved = await service.resolve(created.value.id, {
      outcome: 'full_refund',
      resolutionNote: 'Service not delivered; full refund granted.',
      resolvedBy: 'arb_1',
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.refundAmount).toBe(80);
  });

  it('escalates past SLA and exposes analytics', async () => {
    const created = await service.createDispute(baseCreate({ paymentId: 'pay_sla' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    service.setDeadlinesForTests(created.value.id, '2020-01-01T00:00:00.000Z', '2020-01-02T00:00:00.000Z');

    const esc = await service.processEscalations(new Date('2026-07-30T00:00:00Z'));
    expect(esc.ok).toBe(true);
    if (!esc.ok) return;
    expect(esc.value.escalated).toBe(1);

    const detail = service.getDispute(created.value.id);
    expect(detail.ok && detail.value.status).toBe('escalated');

    const analytics = service.getAnalytics('ten_1');
    expect(analytics.ok).toBe(true);
    if (!analytics.ok) return;
    expect(analytics.value.total).toBe(1);
    expect(analytics.value.escalatedCount).toBe(1);
    expect(analytics.value.escalationRatePct).toBeGreaterThan(0);
    expect(analytics.value.notificationCount).toBeGreaterThan(0);
    expect(analytics.value.byReason.service_not_delivered).toBe(1);
  });

  it('assigns arbitrator from escalated back to under_review', async () => {
    const created = await service.createDispute(baseCreate({ paymentId: 'pay_arb' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await service.escalate(created.value.id, 'admin', 'Needs human review');
    const assigned = await service.assignArbitrator(created.value.id, 'arb_9', 'admin');
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    expect(assigned.value.arbitratorId).toBe('arb_9');
    expect(assigned.value.status).toBe('under_review');
  });

  it('lists notifications for a dispute', async () => {
    const created = await service.createDispute(baseCreate({ paymentId: 'pay_n' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const notes = service.listNotifications(created.value.id);
    expect(notes.ok).toBe(true);
    if (!notes.ok) return;
    expect(notes.value.every((n) => n.delivered)).toBe(true);
    expect(notes.value.some((n) => n.templateId === 'dispute_opened')).toBe(true);
  });
});
