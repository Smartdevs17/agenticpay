import { describe, it, expect, beforeEach, vi } from 'vitest';

const { increment, gauge, info } = vi.hoisted(() => ({
  increment: vi.fn(),
  gauge: vi.fn(),
  info: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({ logger: { info, warn: vi.fn(), error: vi.fn() } }));

import {
  addEvidence,
  getEvidenceScores,
  computeDisputePriority,
  runDisputeAutomation,
  getAutomationDecisions,
  scoreEvidenceWithRubric,
  removeEvidence,
  resetForTests,
  setDisputeAutomationMetrics,
  DisputeAutomationError,
  DEFAULT_EVIDENCE_RUBRIC,
  type EvidenceType,
} from '../disputeAutomation.js';

const NOW = new Date().toISOString();

describe('disputeAutomation rubric', () => {
  beforeEach(() => {
    resetForTests();
    setDisputeAutomationMetrics({ increment, gauge });
    increment.mockClear();
    gauge.mockClear();
    info.mockClear();
  });

  describe('scoring breakdown', () => {
    it('explains every rubric criterion and matches the overall score', () => {
      addEvidence('d1', 'document', 'https://example.com/contract.pdf', 'Signed contract with delivery terms', 'buyer');
      const [score] = getEvidenceScores('d1');

      expect(score.rubricVersion).toBe(DEFAULT_EVIDENCE_RUBRIC.version);
      expect(score.breakdown.map((c) => c.criterion)).toEqual(['relevance', 'credibility', 'completeness']);
      for (const c of score.breakdown) expect(c.reason.length).toBeGreaterThan(0);

      const weighted = Math.round(score.breakdown.reduce((sum, c) => sum + c.score * c.weight, 0));
      expect(score.overallScore).toBe(weighted);
      // 90*0.4 + 70*0.35 + 80*0.25
      expect(score.overallScore).toBe(81);
    });

    it('flags evidence without an attachment and lowers completeness', () => {
      addEvidence('d1', 'communication', '', 'Chat log where seller agreed to refund', 'buyer');
      const [score] = getEvidenceScores('d1');

      expect(score.completenessScore).toBe(40);
      expect(score.flags).toContain('missing_attachment');
    });

    it('penalises repeated submissions of the same type by the same party', () => {
      addEvidence('d1', 'screenshot', 'https://example.com/1.png', 'Screenshot of the broken checkout page', 'buyer');
      addEvidence('d1', 'screenshot', 'https://example.com/2.png', 'Second screenshot of the checkout error', 'buyer');

      for (const score of getEvidenceScores('d1')) {
        expect(score.credibilityScore).toBe(60);
        expect(score.flags).toContain('repeated_submission_type');
      }
    });

    it('rescores remaining evidence after removal', () => {
      const a = addEvidence('d1', 'screenshot', 'https://example.com/1.png', 'Screenshot of the broken checkout page', 'buyer');
      addEvidence('d1', 'screenshot', 'https://example.com/2.png', 'Second screenshot of the checkout error', 'buyer');

      expect(removeEvidence('d1', a.id)).toBe(true);
      const [score] = getEvidenceScores('d1');
      expect(score.flags).not.toContain('repeated_submission_type');
    });

    it('scores against a custom rubric without changing stored scores', () => {
      addEvidence('d1', 'transaction_proof', 'https://example.com/tx', 'On-chain transaction hash for the payment', 'buyer');
      const custom = scoreEvidenceWithRubric('d1', {
        version: 'relevance-only',
        weights: { relevance: 1, credibility: 0, completeness: 0 },
      });

      expect(custom[0].overallScore).toBe(100);
      expect(custom[0].rubricVersion).toBe('relevance-only');
      expect(getEvidenceScores('d1')[0].rubricVersion).toBe(DEFAULT_EVIDENCE_RUBRIC.version);
    });

    it('rejects a rubric whose weights do not sum to 1', () => {
      expect(() =>
        scoreEvidenceWithRubric('d1', { version: 'bad', weights: { relevance: 0.5, credibility: 0.5, completeness: 0.5 } }),
      ).toThrow(DisputeAutomationError);
    });
  });

  describe('input validation', () => {
    it('rejects unknown evidence types', () => {
      expect(() => addEvidence('d1', 'video' as EvidenceType, 'https://example.com/v.mp4', 'A video clip', 'buyer')).toThrow(
        /Unknown evidence type/,
      );
    });

    it('rejects unsafe or malformed urls', () => {
      expect(() => addEvidence('d1', 'document', 'javascript:alert(1)', 'Looks like a document', 'buyer')).toThrow(/not allowed/);
      expect(() => addEvidence('d1', 'document', 'not a url', 'Looks like a document', 'buyer')).toThrow(/not a valid URL/);
    });

    it('requires a dispute id and submitter', () => {
      expect(() => addEvidence(' ', 'document', '', 'desc', 'buyer')).toThrow(/disputeId/);
      expect(() => addEvidence('d1', 'document', '', 'desc', '')).toThrow(/submittedBy/);
    });

    it('rejects an invalid createdAt instead of returning NaN scores', () => {
      expect(() => computeDisputePriority('d1', 'yesterday', 100)).toThrow(/Invalid createdAt/);
    });

    it('rejects negative escrow amounts', () => {
      expect(() => computeDisputePriority('d1', NOW, -5)).toThrow(/Invalid escrowAmount/);
    });

    it('rejects inconsistent thresholds', () => {
      expect(() =>
        computeDisputePriority('d1', NOW, 100, {
          autoResolveThreshold: 60,
          fastTrackThreshold: 70,
          escalateThreshold: 30,
          minEvidenceForAutoResolve: 2,
          maxAgeForAutoResolveHours: 48,
        }),
      ).toThrow(/Thresholds/);
    });

    it('treats a createdAt in the future as a brand new dispute', () => {
      const future = new Date(Date.now() + 10 * 3600_000).toISOString();
      const fresh = computeDisputePriority('d1', NOW, 0);
      expect(computeDisputePriority('d1', future, 0).priorityScore).toBe(fresh.priorityScore);
    });
  });

  describe('runDisputeAutomation', () => {
    it('escalates a dispute with no evidence and explains why', () => {
      const old = new Date(Date.now() - 72 * 3600_000).toISOString();
      const decision = runDisputeAutomation({ disputeId: 'd1', createdAt: old, escrowAmount: 0 });

      expect(decision.recommendedAction).toBe('escalate');
      expect(decision.evidenceCount).toBe(0);
      expect(decision.reasons).toContain('no evidence submitted');
      expect(decision.decisionId).toMatch(/^dad_/);
    });

    it('routes strong, fresh, high value evidence to auto resolve', () => {
      addEvidence('d1', 'transaction_proof', 'https://example.com/tx', 'On-chain transaction hash for the payment', 'buyer');
      addEvidence('d1', 'document', 'https://example.com/invoice.pdf', 'Invoice matching the escrow amount', 'buyer');

      const decision = runDisputeAutomation(
        { disputeId: 'd1', createdAt: NOW, escrowAmount: 10_000 },
        {
          autoResolveThreshold: 80,
          fastTrackThreshold: 70,
          escalateThreshold: 30,
          minEvidenceForAutoResolve: 2,
          maxAgeForAutoResolveHours: 48,
        },
      );

      expect(decision.recommendedAction).toBe('auto_resolve');
      expect(decision.estimatedResolutionHours).toBe(1);
      expect(decision.averageEvidenceScore).toBeGreaterThanOrEqual(75);
    });

    it('does not auto resolve with less evidence than required', () => {
      addEvidence('d1', 'transaction_proof', 'https://example.com/tx', 'On-chain transaction hash for the payment', 'buyer');

      const decision = runDisputeAutomation(
        { disputeId: 'd1', createdAt: NOW, escrowAmount: 10_000 },
        {
          autoResolveThreshold: 80,
          fastTrackThreshold: 70,
          escalateThreshold: 30,
          minEvidenceForAutoResolve: 2,
          maxAgeForAutoResolveHours: 48,
        },
      );

      expect(decision.recommendedAction).toBe('fast_track');
      expect(decision.reasons.some((r) => r.includes('auto-resolve not allowed'))).toBe(true);
    });

    it('keeps a decision log per dispute', () => {
      runDisputeAutomation({ disputeId: 'd1', createdAt: NOW, escrowAmount: 100 });
      addEvidence('d1', 'document', 'https://example.com/a.pdf', 'Delivery confirmation from courier', 'seller');
      runDisputeAutomation({ disputeId: 'd1', createdAt: NOW, escrowAmount: 100 });

      const log = getAutomationDecisions('d1');
      expect(log).toHaveLength(2);
      expect(log[1].evidenceCount).toBe(1);
      expect(getAutomationDecisions('other')).toEqual([]);
    });

    it('emits metrics and a structured log line for each decision', () => {
      const decision = runDisputeAutomation({ disputeId: 'd1', createdAt: NOW, escrowAmount: 100 });
      const tags = { action: decision.recommendedAction, strength: decision.evidenceStrength };

      expect(increment).toHaveBeenCalledWith('dispute_automation.decision', 1, tags);
      expect(gauge).toHaveBeenCalledWith('dispute_automation.priority_score', decision.priorityScore, tags);
      expect(info).toHaveBeenCalledWith(
        '[dispute-automation] decision',
        expect.objectContaining({ disputeId: 'd1', action: decision.recommendedAction }),
      );
    });

    it('does not record a decision when inputs are invalid', () => {
      expect(() => runDisputeAutomation({ disputeId: 'd1', createdAt: 'bad', escrowAmount: 1 })).toThrow();
      expect(getAutomationDecisions('d1')).toEqual([]);
      expect(increment).not.toHaveBeenCalled();
    });
  });
});
