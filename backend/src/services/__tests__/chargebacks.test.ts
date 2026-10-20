import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import {
  createChargeback,
  getChargeback,
  listChargebacks,
  updateChargebackStatus,
  submitEvidence,
  removeEvidence,
  addNote,
  isEvidenceWindowClosed,
  summarizeChargebacks,
  resetChargebacksForTests,
  CreateChargebackInput,
} from '../chargebacks.js';

const baseInput: CreateChargebackInput = {
  merchantId: 'merchant-1',
  paymentId: 'payment-1',
  customerId: 'customer-1',
  amount: 150.5,
  currency: 'USD',
  reason: 'fraudulent',
};

describe('chargebacks service', () => {
  beforeEach(() => {
    resetChargebacksForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a chargeback in the received state with a deadline', () => {
    const chargeback = createChargeback(baseInput);
    expect(chargeback.id).toMatch(/^cb_/);
    expect(chargeback.status).toBe('received');
    expect(chargeback.evidence).toHaveLength(0);
    expect(new Date(chargeback.evidenceDueBy).getTime()).toBeGreaterThan(Date.now());
    expect(chargeback.timeline[0].type).toBe('created');
  });

  it('rejects non-positive amounts', () => {
    expect(() => createChargeback({ ...baseInput, amount: 0 })).toThrow(/greater than zero/);
  });

  it('honours a custom evidence window', () => {
    const chargeback = createChargeback({ ...baseInput, evidenceWindowDays: 1 });
    const dueMs = new Date(chargeback.evidenceDueBy).getTime() - Date.now();
    expect(dueMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('retrieves and lists chargebacks by merchant and status', () => {
    const a = createChargeback(baseInput);
    createChargeback({ ...baseInput, merchantId: 'merchant-2' });
    expect(getChargeback(a.id)?.id).toBe(a.id);
    expect(getChargeback('missing')).toBeNull();
    expect(listChargebacks({ merchantId: 'merchant-1' })).toHaveLength(1);
    expect(listChargebacks({ status: 'received' })).toHaveLength(2);
  });

  it('enforces valid status transitions', () => {
    const chargeback = createChargeback(baseInput);
    const updated = updateChargebackStatus(chargeback.id, 'under_review', 'agent');
    expect(updated.status).toBe('under_review');

    expect(() => updateChargebackStatus(chargeback.id, 'won', 'agent')).toThrow(
      /Invalid status transition/,
    );
  });

  it('marks resolvedAt when reaching a terminal status', () => {
    const chargeback = createChargeback(baseInput);
    updateChargebackStatus(chargeback.id, 'under_review', 'agent');
    updateChargebackStatus(chargeback.id, 'representment', 'agent');
    const won = updateChargebackStatus(chargeback.id, 'won', 'agent');
    expect(won.status).toBe('won');
    expect(won.resolvedAt).toBeDefined();
  });

  it('throws when updating an unknown chargeback', () => {
    expect(() => updateChargebackStatus('nope', 'under_review', 'agent')).toThrow(
      /Chargeback not found/,
    );
  });

  it('submits evidence and moves the case to evidence_submitted', () => {
    const chargeback = createChargeback(baseInput);
    const updated = submitEvidence(chargeback.id, {
      type: 'delivery_proof',
      description: 'Signed delivery receipt',
      fileUrl: 'https://example.com/receipt.pdf',
      submittedBy: 'merchant-1',
    });
    expect(updated.status).toBe('evidence_submitted');
    expect(updated.evidence).toHaveLength(1);
    expect(updated.timeline.some((e) => e.type === 'evidence_submitted')).toBe(true);
  });

  it('prevents evidence submission after the deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const chargeback = createChargeback({ ...baseInput, evidenceWindowDays: 1 });
    vi.setSystemTime(new Date('2026-01-05T00:00:00Z'));
    expect(isEvidenceWindowClosed(chargeback)).toBe(true);
    expect(() =>
      submitEvidence(chargeback.id, {
        type: 'receipt',
        description: 'late',
        submittedBy: 'merchant-1',
      }),
    ).toThrow(/deadline has passed/);
  });

  it('prevents evidence submission on a closed chargeback', () => {
    const chargeback = createChargeback(baseInput);
    updateChargebackStatus(chargeback.id, 'under_review', 'agent');
    updateChargebackStatus(chargeback.id, 'accepted', 'agent');
    expect(() =>
      submitEvidence(chargeback.id, {
        type: 'receipt',
        description: 'nope',
        submittedBy: 'merchant-1',
      }),
    ).toThrow(/closed chargeback/);
  });

  it('removes evidence', () => {
    const chargeback = createChargeback(baseInput);
    const withEvidence = submitEvidence(chargeback.id, {
      type: 'receipt',
      description: 'receipt',
      submittedBy: 'merchant-1',
    });
    const evidenceId = withEvidence.evidence[0].id;
    const updated = removeEvidence(chargeback.id, evidenceId, 'agent');
    expect(updated.evidence).toHaveLength(0);
    expect(() => removeEvidence(chargeback.id, 'missing', 'agent')).toThrow(/Evidence not found/);
  });

  it('adds notes to the timeline', () => {
    const chargeback = createChargeback(baseInput);
    const updated = addNote(chargeback.id, 'Customer contacted', 'agent');
    expect(updated.notes).toContain('Customer contacted');
    expect(updated.timeline.some((e) => e.type === 'note_added')).toBe(true);
  });

  it('summarizes chargebacks with win rate and recovered amount', () => {
    const won = createChargeback({ ...baseInput, amount: 100 });
    updateChargebackStatus(won.id, 'under_review', 'agent');
    updateChargebackStatus(won.id, 'representment', 'agent');
    updateChargebackStatus(won.id, 'won', 'agent');

    const lost = createChargeback({ ...baseInput, amount: 50 });
    updateChargebackStatus(lost.id, 'under_review', 'agent');
    updateChargebackStatus(lost.id, 'accepted', 'agent');

    const summary = summarizeChargebacks('merchant-1');
    expect(summary.total).toBe(2);
    expect(summary.disputedAmount).toBe(150);
    expect(summary.recoveredAmount).toBe(100);
    expect(summary.winRate).toBe(100);
  });

  it('returns a zero win rate when no case is decided', () => {
    createChargeback(baseInput);
    const summary = summarizeChargebacks('merchant-1');
    expect(summary.winRate).toBe(0);
  });
});
