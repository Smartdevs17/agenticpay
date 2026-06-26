import { describe, it, expect } from 'vitest';
import {
  simulateSwap,
  computeMinAmountOut,
  assessSandwichRisk,
  InvalidSimulationInputError,
  MAX_SLIPPAGE_BPS,
} from '../slippage-protection.js';

function stablePriceHistory(price: number, count = 5, stepMs = 5000): { price: number; timestampMs: number }[] {
  const now = Date.now() - count * stepMs;
  return Array.from({ length: count }, (_, i) => ({ price, timestampMs: now + i * stepMs }));
}

describe('computeMinAmountOut', () => {
  it('applies the requested tolerance', () => {
    expect(computeMinAmountOut(1000, 100)).toBeCloseTo(990, 5); // 1%
  });

  it('clamps tolerance above the hard cap to MAX_SLIPPAGE_BPS', () => {
    expect(computeMinAmountOut(1000, 10_000)).toBeCloseTo(950, 5); // clamped to 5%
    expect(MAX_SLIPPAGE_BPS).toBe(500);
  });

  it('treats negative requested slippage as zero', () => {
    expect(computeMinAmountOut(1000, -50)).toBe(1000);
  });
});

describe('assessSandwichRisk', () => {
  it('reports low risk for a stable price history matching the quote', () => {
    const history = stablePriceHistory(2.0);
    const risk = assessSandwichRisk({ amountIn: 100, quotedPrice: 2.0, priceHistory: history });
    expect(risk.detected).toBe(false);
    expect(risk.riskScore).toBeLessThan(0.4);
  });

  it('flags a sharp recent price spike as a likely front-run', () => {
    const baseline = stablePriceHistory(2.0, 4, 10_000);
    const spike = [
      { price: 2.3, timestampMs: Date.now() - 2000 },
      { price: 2.35, timestampMs: Date.now() - 1000 },
      { price: 2.4, timestampMs: Date.now() },
    ];
    const risk = assessSandwichRisk({ amountIn: 100, quotedPrice: 2.4, priceHistory: [...baseline, ...spike] });
    expect(risk.detected).toBe(true);
    expect(risk.reasons.some((r) => r.includes('front-run'))).toBe(true);
  });

  it('flags large trades relative to pool liquidity', () => {
    const history = stablePriceHistory(1.0);
    const risk = assessSandwichRisk({ amountIn: 50_000, quotedPrice: 1.0, priceHistory: history, poolLiquidity: 100_000 });
    expect(risk.riskScore).toBeGreaterThan(0);
    expect(risk.reasons.some((r) => r.includes('pool liquidity'))).toBe(true);
  });

  it('flags a quoted price that diverges sharply from last observed market price', () => {
    const history = stablePriceHistory(1.0);
    const risk = assessSandwichRisk({ amountIn: 100, quotedPrice: 1.5, priceHistory: history });
    expect(risk.reasons.some((r) => r.includes('diverges'))).toBe(true);
  });
});

describe('simulateSwap', () => {
  it('returns expected output, min output, and a quote deadline for a clean trade', () => {
    const history = stablePriceHistory(2.0);
    const result = simulateSwap({ amountIn: 100, quotedPrice: 2.0, priceHistory: history, slippageBps: 100 });

    expect(result.expectedAmountOut).toBeCloseTo(200, 5);
    expect(result.minAmountOut).toBeCloseTo(198, 5);
    expect(result.effectiveSlippageBps).toBe(100);
    expect(result.shouldWarnUser).toBe(false);
    expect(result.quoteDeadlineMs).toBeGreaterThan(Date.now());
  });

  it('warns the user when sandwich risk is detected', () => {
    const baseline = stablePriceHistory(1.0, 4, 10_000);
    const spike = [
      { price: 1.2, timestampMs: Date.now() - 2000 },
      { price: 1.25, timestampMs: Date.now() - 1000 },
      { price: 1.3, timestampMs: Date.now() },
    ];
    const result = simulateSwap({ amountIn: 100, quotedPrice: 1.3, priceHistory: [...baseline, ...spike] });
    expect(result.shouldWarnUser).toBe(true);
    expect(result.sandwichRisk.detected).toBe(true);
  });

  it('rejects non-positive amountIn or quotedPrice', () => {
    const history = stablePriceHistory(1.0);
    expect(() => simulateSwap({ amountIn: 0, quotedPrice: 1.0, priceHistory: history })).toThrow(
      InvalidSimulationInputError
    );
    expect(() => simulateSwap({ amountIn: 100, quotedPrice: -1, priceHistory: history })).toThrow(
      InvalidSimulationInputError
    );
  });

  it('defaults to the protocol default slippage tolerance when none is provided', () => {
    const history = stablePriceHistory(1.0);
    const result = simulateSwap({ amountIn: 100, quotedPrice: 1.0, priceHistory: history });
    expect(result.effectiveSlippageBps).toBe(100);
  });
});
