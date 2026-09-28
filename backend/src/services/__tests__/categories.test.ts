import { describe, it, expect } from 'vitest';
import { scoreCategories, inferCategory } from '../categories.js';

describe('scoreCategories', () => {
  it('ranks refund highest for a refund payment', () => {
    const scores = scoreCategories({ type: 'refund' });
    expect(scores[0]).toEqual({ category: 'refund', confidence: 0.95 });
  });

  it('stacks signals for the same category, capped at 1', () => {
    const scores = scoreCategories({ type: 'full_payment', network: 'stellar' });
    // strong stellar-escrow signal (0.8) + weak generic full_payment signal (0.3), capped at 1
    expect(scores[0]).toEqual({ category: 'escrow', confidence: 1 });
  });

  it('falls back to other at full confidence when nothing matches', () => {
    expect(scoreCategories({ type: 'unknown_type' })).toEqual([{ category: 'other', confidence: 1 }]);
  });

  it('inferCategory returns the top-scored category', () => {
    expect(inferCategory({ metadata: { invoiceId: 'inv_1' } })).toBe('invoice');
  });
});
