/**
 * AI-Powered Payment Routing Engine (#446)
 *
 * Selects the optimal chain for each payment using a lightweight scoring model
 * that weighs real-time chain performance metrics (gas price, latency,
 * success rate) collected by the routing evaluation queue.
 *
 * Design:
 *  - Feature extraction from Redis sorted sets (populated by the queue)
 *  - Weighted linear scoring as the "ML" model (drop-in for XGBoost inference)
 *  - Decision logged to RoutingDecision table for auditability & A/B testing
 *  - <50ms p99 – pure in-memory computation, no DB hit on hot path
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChainFeatures {
  chain: string;
  avgGasPrice: number;       // gwei or stroops
  avgConfirmTimeMs: number;
  successRate: number;       // 0–1
  p99LatencyMs: number;
}

export interface RoutingRequest {
  tenantId?: string;
  amount: number;
  fromAsset: string;
  preferSpeed?: boolean;
  preferCost?: boolean;
  abVariant?: 'static' | 'ai';
  manualOverride?: { chain: string; actor: string };
}

export interface RoutingResult {
  requestId: string;
  selectedChain: string;
  fallbackChains: string[];
  rationale: string;
  latencyMs: number;
  scores: Record<string, number>;
}

// ─── Model weights (tunable / replace with ONNX/XGBoost inference) ────────────

interface ModelWeights {
  gasPrice: number;       // lower is better
  confirmTime: number;    // lower is better
  successRate: number;    // higher is better
  p99Latency: number;     // lower is better
}

const DEFAULT_WEIGHTS: ModelWeights = {
  gasPrice: 0.30,
  confirmTime: 0.25,
  successRate: 0.30,
  p99Latency: 0.15,
};

const SPEED_WEIGHTS: ModelWeights = {
  gasPrice: 0.15,
  confirmTime: 0.40,
  successRate: 0.25,
  p99Latency: 0.20,
};

const COST_WEIGHTS: ModelWeights = {
  gasPrice: 0.50,
  confirmTime: 0.15,
  successRate: 0.25,
  p99Latency: 0.10,
};

// ─── Feature store (Redis-backed or fallback to DB) ───────────────────────────

export type FeatureStore = {
  getFeatures(): Promise<ChainFeatures[]>;
};

function buildInMemoryStore(): FeatureStore {
  // Fallback static data – replaced at runtime by the routing queue
  const defaults: ChainFeatures[] = [
    { chain: 'stellar', avgGasPrice: 0.00001, avgConfirmTimeMs: 5_000, successRate: 0.98, p99LatencyMs: 6_000 },
    { chain: 'evm',     avgGasPrice: 30,      avgConfirmTimeMs: 15_000, successRate: 0.94, p99LatencyMs: 20_000 },
  ];
  return { getFeatures: async () => defaults };
}

let _featureStore: FeatureStore = buildInMemoryStore();

export function setFeatureStore(store: FeatureStore): void {
  _featureStore = store;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

function scoreChains(
  features: ChainFeatures[],
  weights: ModelWeights,
): { chain: string; score: number }[] {
  if (features.length === 0) return [];

  const gasPrices = features.map((f) => f.avgGasPrice);
  const confirmTimes = features.map((f) => f.avgConfirmTimeMs);
  const p99Latencies = features.map((f) => f.p99LatencyMs);

  const minGas = Math.min(...gasPrices), maxGas = Math.max(...gasPrices);
  const minTime = Math.min(...confirmTimes), maxTime = Math.max(...confirmTimes);
  const minP99 = Math.min(...p99Latencies), maxP99 = Math.max(...p99Latencies);

  return features.map((f) => {
    // For cost metrics: lower is better → invert normalisation
    const gasScore      = 1 - normalize(f.avgGasPrice,       minGas,  maxGas);
    const confirmScore  = 1 - normalize(f.avgConfirmTimeMs,  minTime, maxTime);
    const successScore  = f.successRate; // already 0–1, higher is better
    const p99Score      = 1 - normalize(f.p99LatencyMs,      minP99,  maxP99);

    const score =
      weights.gasPrice     * gasScore +
      weights.confirmTime  * confirmScore +
      weights.successRate  * successScore +
      weights.p99Latency   * p99Score;

    return { chain: f.chain, score: Math.round(score * 10_000) / 10_000 };
  }).sort((a, b) => b.score - a.score);
}

// ─── Main router class ────────────────────────────────────────────────────────

export class AiPaymentRouter {
  async route(req: RoutingRequest): Promise<RoutingResult> {
    const start = Date.now();
    const requestId = randomUUID();

    // Manual override short-circuits the model
    if (req.manualOverride) {
      const result: RoutingResult = {
        requestId,
        selectedChain: req.manualOverride.chain,
        fallbackChains: [],
        rationale: `Manual override by ${req.manualOverride.actor}`,
        latencyMs: Date.now() - start,
        scores: {},
      };
      void this.logDecision(result, req, {}, true);
      return result;
    }

    const features = await _featureStore.getFeatures();

    // Choose weight profile
    const weights = req.preferSpeed
      ? SPEED_WEIGHTS
      : req.preferCost
      ? COST_WEIGHTS
      : DEFAULT_WEIGHTS;

    const scored = scoreChains(features, weights);

    if (scored.length === 0) {
      throw new Error('No chain features available for routing');
    }

    const [best, ...rest] = scored;
    const scores = Object.fromEntries(scored.map((s) => [s.chain, s.score]));
    const featureSnapshot = Object.fromEntries(
      features.map((f) => [f.chain, f]),
    ) as Record<string, unknown>;

    const result: RoutingResult = {
      requestId,
      selectedChain: best.chain,
      fallbackChains: rest.map((s) => s.chain),
      rationale: `Selected ${best.chain} (score: ${best.score}) using ${req.preferSpeed ? 'speed' : req.preferCost ? 'cost' : 'balanced'} weights`,
      latencyMs: Date.now() - start,
      scores,
    };

    void this.logDecision(result, req, featureSnapshot as Record<string, unknown>, false);
    return result;
  }

  private async logDecision(
    result: RoutingResult,
    req: RoutingRequest,
    featureSnapshot: Record<string, unknown>,
    isManualOverride: boolean,
  ): Promise<void> {
    try {
      await prisma.routingDecision.create({
        data: {
          requestId: result.requestId,
          tenantId: req.tenantId,
          selectedChain: result.selectedChain,
          fallbackChains: result.fallbackChains,
          scoreStellar: result.scores['stellar'] ?? null,
          scoreEvm: result.scores['evm'] ?? null,
          featureSnapshot,
          rationale: result.rationale,
          latencyMs: result.latencyMs,
          isManualOverride,
          overrideBy: req.manualOverride?.actor,
          abVariant: req.abVariant ?? 'ai',
        },
      });
    } catch {
      // non-fatal: routing continues even if logging fails
    }
  }
}

export const aiRouter = new AiPaymentRouter();
