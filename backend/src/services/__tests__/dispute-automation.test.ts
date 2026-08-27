import { describe, it, expect, beforeEach } from 'vitest';
import {
  addEvidence,
  getEvidenceScores,
  computeDisputePriority,
  getEvidenceForDispute,
  removeEvidence,
  resetForTests,
} from '../disputeAutomation.js';

describe('disputeAutomation', () => {
  beforeEach(() => {
    resetForTests();
  });

  describe('addEvidence', () => {
    it('adds evidence and returns item', () => {
      const item = addEvidence(
        'd1',
        'transaction_proof',
        'https://example.com/proof.png',
        'Transaction receipt showing payment',
        'user1',
      );

      expect(item.id).toMatch(/^ev_/);
      expect(item.disputeId).toBe('d1');
      expect(item.type).toBe('transaction_proof');
    });

    it('accumulates evidence for same dispute', () => {
      addEvidence('d1', 'document', 'https://example.com/doc.pdf', 'Contract document', 'user1');
      addEvidence('d1', 'screenshot', 'https://example.com/ss.png', 'Screenshot of issue', 'user2');

      const items = getEvidenceForDispute('d1');
      expect(items).toHaveLength(2);
    });
  });

  describe('getEvidenceScores', () => {
    it('scores evidence items', () => {
      addEvidence('d1', 'transaction_proof', 'https://example.com/proof.png', 'Detailed transaction proof', 'user1');

      const scores = getEvidenceScores('d1');
      expect(scores).toHaveLength(1);
      expect(scores[0].overallScore).toBeGreaterThan(0);
      expect(scores[0].relevanceScore).toBe(100); // transaction_proof has weight 1.0
    });

    it('flags vague descriptions', () => {
      addEvidence('d1', 'other', 'https://example.com/x.png', 'bad', 'user1');

      const scores = getEvidenceScores('d1');
      expect(scores[0].flags).toContain('vague_description');
    });
  });

  describe('computeDisputePriority', () => {
    it('returns strong priority with good evidence', () => {
      addEvidence('d1', 'transaction_proof', 'https://example.com/proof.png', 'Detailed proof of payment', 'user1');
      addEvidence('d1', 'document', 'https://example.com/doc.pdf', 'Supporting contract document', 'user1');

      const priority = computeDisputePriority(
        'd1',
        new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1 hour ago
        500,
      );

      expect(priority.evidenceStrength).toBe('strong');
      expect(priority.priorityScore).toBeGreaterThan(50);
    });

    it('returns insufficient with no evidence', () => {
      const priority = computeDisputePriority(
        'd1',
        new Date(Date.now() - 1000 * 60 * 60).toISOString(),
        100,
      );

      expect(priority.evidenceStrength).toBe('insufficient');
    });

    it('recommends auto_resolve for high scores', () => {
      for (let i = 0; i < 3; i++) {
        addEvidence('d1', 'transaction_proof', `https://example.com/${i}.png', 'Proof of transaction', 'user1');
      }

      const priority = computeDisputePriority(
        'd1',
        new Date(Date.now() - 1000 * 60 * 60).toISOString(),
        1000,
      );

      expect(priority.recommendedAction).toBe('auto_resolve');
    });
  });

  describe('removeEvidence', () => {
    it('removes evidence and re-scores', () => {
      const item = addEvidence('d1', 'document', 'https://example.com/doc.pdf', 'Contract', 'user1');
      addEvidence('d1', 'screenshot', 'https://example.com/ss.png', 'Screenshot', 'user2');

      expect(getEvidenceForDispute('d1')).toHaveLength(2);

      const removed = removeEvidence('d1', item.id);
      expect(removed).toBe(true);
      expect(getEvidenceForDispute('d1')).toHaveLength(1);
    });

    it('returns false for non-existent evidence', () => {
      expect(removeEvidence('d1', 'fake_id')).toBe(false);
    });
  });
});
