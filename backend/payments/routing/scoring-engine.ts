import { NetworkId, NetworkMetrics, RouteScore, UserPreferences } from './types';
import { getNetworkConfig } from './network-registry';

// USD prices of native currencies (would come from price oracle in production)
const NATIVE_PRICES_USD: Record<NetworkId, number> = {
  ethereum: 3500,
  polygon: 0.65,
  arbitrum: 3500, // ETH
  optimism: 3500, // ETH
  base: 3500, // ETH
  avalanche: 35,
  bnb: 600,
};

// Typical gas units for a standard ERC-20 transfer
const TYPICAL_GAS_UNITS = 65000;

function calculateCostScore(metrics: NetworkMetrics): { score: number; feeUsd: number } {
  const nativePrice = NATIVE_PRICES_USD[metrics.networkId];
  const gasCostEth = (metrics.gasPriceGwei * TYPICAL_GAS_UNITS) / 1e9;
  const feeUsd = gasCostEth * nativePrice;

  // Normalize: lower fee = lower score = better
  const score = feeUsd;

  return { score, feeUsd };
}

function calculateSpeedScore(metrics: NetworkMetrics): { score: number; timeSeconds: number } {
  // Estimated confirmation time: block time * 2 (for reasonable confirmation)
  const timeSeconds = metrics.blockTimeSeconds * 2;
  // Normalize: lower time = lower score = better
  const score = timeSeconds;

  return { score, timeSeconds };
}

function calculateReliabilityScore(metrics: NetworkMetrics): number {
  // Penalize high failure rate and congestion
  const failureRate = metrics.totalTxCount24h > 0
    ? metrics.failedTxCount24h / metrics.totalTxCount24h
    : 0;

  const congestionPenalty = {
    low: 0,
    medium: 5,
    high: 15,
    critical: 30,
  }[metrics.congestionLevel];

  return Math.max(0, metrics.reliabilityScore - failureRate * 100 - congestionPenalty);
}

export function scoreNetwork(
  metrics: NetworkMetrics,
  preferences: UserPreferences
): RouteScore {
  const cost = calculateCostScore(metrics);
  const speed = calculateSpeedScore(metrics);
  const reliability = calculateReliabilityScore(metrics);

  // Normalize scores to 0-100 scale for compositing
  const maxFee = 50; // $50 reference max
  const maxTime = 60; // 60s reference max

  const normalizedCost = Math.min(100, (cost.score / maxFee) * 100);
  const normalizedSpeed = Math.min(100, (speed.score / maxTime) * 100);
  const normalizedReliability = reliability;

  // Weight based on user preference
  const weights = {
    cost: { cost: 0.5, speed: 0.2, reliability: 0.3 },
    speed: { cost: 0.2, speed: 0.5, reliability: 0.3 },
    reliability: { cost: 0.2, speed: 0.2, reliability: 0.6 },
  }[preferences.priority];

  const compositeScore =
    normalizedCost * weights.cost +
    normalizedSpeed * weights.speed +
    (100 - normalizedReliability) * weights.reliability; // Invert reliability so lower = better

  return {
    networkId: metrics.networkId,
    costScore: normalizedCost,
    speedScore: normalizedSpeed,
    reliabilityScore: normalizedReliability,
    compositeScore,
    estimatedFeeUsd: cost.feeUsd,
    estimatedTimeSeconds: speed.timeSeconds,
  };
}

export function scoreAllNetworks(
  metrics: NetworkMetrics[],
  preferences: UserPreferences
): RouteScore[] {
  return metrics
    .map((m) => scoreNetwork(m, preferences))
    .sort((a, b) => a.compositeScore - b.compositeScore);
}