import { describe, it, expect } from 'vitest';
import { estimateGas } from '../health.js';

describe('estimateGas', () => {
  it('returns XLM currency', () => {
    const estimate = estimateGas();
    expect(estimate.currency).toBe('XLM');
  });

  it('totalFee equals baseFee + relayerFee', () => {
    const estimate = estimateGas();
    const base = parseFloat(estimate.baseFee);
    const relay = parseFloat(estimate.relayerFee);
    const total = parseFloat(estimate.totalFee);
    expect(total).toBeCloseTo(base + relay, 7);
  });

  it('all fees are positive', () => {
    const estimate = estimateGas();
    expect(parseFloat(estimate.baseFee)).toBeGreaterThan(0);
    expect(parseFloat(estimate.relayerFee)).toBeGreaterThan(0);
    expect(parseFloat(estimate.totalFee)).toBeGreaterThan(0);
  });
});
