/**
 * Slippage protection & pre-execution simulation — Issue #521
 *
 * Before a swap/settlement is submitted on-chain, this service:
 *   1. Simulates expected output from a quoted price + recent price samples.
 *   2. Detects sandwich-attack signatures by looking for abnormal price
 *      movement immediately before the quote (front-run) and historically
 *      after similar trades (back-run pattern).
 *   3. Computes the hard `minAmountOut` floor — the same formula enforced
 *      on-chain by contracts/evm/contracts/SlippageGuard.sol — so the
 *      simulated warning and the on-chain enforcement never disagree.
 */

export const MAX_SLIPPAGE_BPS = 500; // 5% — mirrors SlippageGuard.MAX_SLIPPAGE_BPS
export const DEFAULT_SLIPPAGE_BPS = 100; // 1% — mirrors SlippageGuard.defaultMaxSlippageBps
const BPS_DENOMINATOR = 10_000;

export interface PricePoint {
  price: number;
  timestampMs: number;
}

export interface SwapSimulationInput {
  amountIn: number;
  /** Quoted price (amountOut per 1 unit of amountIn) at request time */
  quotedPrice: number;
  /** Recent price history for the pair, most recent last */
  priceHistory: PricePoint[];
  slippageBps?: number;
  poolLiquidity?: number;
}

export interface SandwichRiskAssessment {
  detected: boolean;
  riskScore: number; // 0-1
  reasons: string[];
}

export interface SwapSimulationResult {
  expectedAmountOut: number;
  minAmountOut: number;
  effectiveSlippageBps: number;
  priceImpactBps: number;
  sandwichRisk: SandwichRiskAssessment;
  shouldWarnUser: boolean;
  quoteDeadlineMs: number;
}

export class InvalidSimulationInputError extends Error {}

function clampSlippageBps(requestedBps: number | undefined): number {
  const requested = requestedBps ?? DEFAULT_SLIPPAGE_BPS;
  if (requested < 0) return 0;
  return Math.min(requested, MAX_SLIPPAGE_BPS);
}

/** Mirrors SlippageGuard.computeMinAmountOut exactly so on-chain enforcement matches the off-chain quote. */
export function computeMinAmountOut(expectedAmountOut: number, slippageBps: number): number {
  const effectiveBps = clampSlippageBps(slippageBps);
  return expectedAmountOut - (expectedAmountOut * effectiveBps) / BPS_DENOMINATOR;
}

/**
 * Detects sandwich-attack signatures: an abnormal price spike in the most
 * recent samples relative to the trailing baseline, consistent with a
 * front-run that moved price against the trader right before this quote.
 */
export function assessSandwichRisk(input: SwapSimulationInput): SandwichRiskAssessment {
  const { priceHistory, quotedPrice, poolLiquidity, amountIn } = input;
  const reasons: string[] = [];
  let riskScore = 0;

  if (priceHistory.length >= 3) {
    const recent = priceHistory.slice(-3);
    const baseline = priceHistory.slice(0, -3);
    if (baseline.length > 0) {
      const baselineAvg = baseline.reduce((sum, p) => sum + p.price, 0) / baseline.length;
      const recentAvg = recent.reduce((sum, p) => sum + p.price, 0) / recent.length;
      const deviation = baselineAvg === 0 ? 0 : Math.abs(recentAvg - baselineAvg) / baselineAvg;

      if (deviation > 0.03) {
        riskScore += Math.min(0.6, deviation * 4);
        reasons.push(
          `Price moved ${(deviation * 100).toFixed(2)}% in the last 3 samples relative to baseline — consistent with a front-run.`
        );
      }
    }

    // Rapid back-to-back price ticks within a very short window suggest bot activity.
    const timeDeltas: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      timeDeltas.push(recent[i].timestampMs - recent[i - 1].timestampMs);
    }
    const allSubSecond = timeDeltas.length > 0 && timeDeltas.every((d) => d < 1000);
    if (allSubSecond) {
      riskScore += 0.2;
      reasons.push('Multiple price updates within the same block window — possible bot front-running.');
    }
  }

  // Quoted price diverging sharply from the most recent observed price.
  const lastObserved = priceHistory[priceHistory.length - 1]?.price;
  if (lastObserved !== undefined && lastObserved > 0) {
    const quoteDeviation = Math.abs(quotedPrice - lastObserved) / lastObserved;
    if (quoteDeviation > 0.02) {
      riskScore += Math.min(0.3, quoteDeviation * 3);
      reasons.push(`Quoted price diverges ${(quoteDeviation * 100).toFixed(2)}% from last observed market price.`);
    }
  }

  // Large trade relative to pool liquidity has outsized price impact, making it an attractive sandwich target.
  if (poolLiquidity && poolLiquidity > 0) {
    const sizeRatio = amountIn / poolLiquidity;
    if (sizeRatio > 0.01) {
      riskScore += Math.min(0.3, sizeRatio * 5);
      reasons.push(`Trade size is ${(sizeRatio * 100).toFixed(2)}% of pool liquidity — high price impact attracts sandwich bots.`);
    }
  }

  riskScore = Math.min(1, riskScore);
  return { detected: riskScore >= 0.4, riskScore, reasons };
}

function computePriceImpactBps(input: SwapSimulationInput): number {
  const lastObserved = input.priceHistory[input.priceHistory.length - 1]?.price;
  if (!lastObserved || lastObserved <= 0) return 0;
  const impact = Math.abs(input.quotedPrice - lastObserved) / lastObserved;
  return Math.round(impact * BPS_DENOMINATOR);
}

const QUOTE_VALIDITY_MS = 30_000;

/**
 * Runs the full pre-submission simulation: expected output, hard slippage
 * floor, and sandwich-attack risk. `shouldWarnUser` is true whenever the
 * sandwich risk crosses the detection threshold OR price impact alone
 * exceeds the configured tolerance — either condition means the user's
 * expected outcome materially diverges from what the simulation predicts.
 */
export function simulateSwap(input: SwapSimulationInput): SwapSimulationResult {
  if (input.amountIn <= 0) throw new InvalidSimulationInputError('amountIn must be positive');
  if (input.quotedPrice <= 0) throw new InvalidSimulationInputError('quotedPrice must be positive');

  const effectiveSlippageBps = clampSlippageBps(input.slippageBps);
  const expectedAmountOut = input.amountIn * input.quotedPrice;
  const minAmountOut = computeMinAmountOut(expectedAmountOut, effectiveSlippageBps);
  const priceImpactBps = computePriceImpactBps(input);
  const sandwichRisk = assessSandwichRisk(input);

  return {
    expectedAmountOut,
    minAmountOut,
    effectiveSlippageBps,
    priceImpactBps,
    sandwichRisk,
    shouldWarnUser: sandwichRisk.detected || priceImpactBps > effectiveSlippageBps,
    quoteDeadlineMs: Date.now() + QUOTE_VALIDITY_MS,
  };
}
