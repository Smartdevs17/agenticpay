import { describe, it, expect } from 'vitest';
import { inferCategory } from '../../services/categories.js';

describe('inferCategory', () => {
  it('returns refund for type=refund', () => {
    expect(inferCategory({ type: 'refund' })).toBe('refund');
  });

  it('returns milestone for type=milestone_payment', () => {
    expect(inferCategory({ type: 'milestone_payment' })).toBe('milestone');
  });

  it('returns escrow for stellar full_payment', () => {
    expect(inferCategory({ type: 'full_payment', network: 'stellar' })).toBe('escrow');
  });

  it('returns subscription when metadata.subscriptionId is set', () => {
    expect(inferCategory({ metadata: { subscriptionId: 'sub-1' } })).toBe('subscription');
  });

  it('returns invoice when metadata.invoiceId is set', () => {
    expect(inferCategory({ metadata: { invoiceId: 'inv-1' } })).toBe('invoice');
  });

  it('returns donation when metadata.isDonation=true', () => {
    expect(inferCategory({ metadata: { isDonation: true } })).toBe('donation');
  });

  it('returns other when no rule matches', () => {
    expect(inferCategory({})).toBe('other');
  });

  it('refund rule takes priority over subscription metadata', () => {
    expect(inferCategory({ type: 'refund', metadata: { subscriptionId: 's1' } })).toBe('refund');
  });
});
