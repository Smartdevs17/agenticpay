import { NetworkId, PaymentRoute, RouteScore, UserPreferences, NetworkMetrics } from './types';
import { scoreAllNetworks } from './scoring-engine';
import { getBridgeContract, getAllNetworkIds } from './network-registry';
import { getNetworkStatus } from './network-monitor';

interface RoutingContext {
  amountUsd: number;
  tokenAddress?: string;
  fromAddress: string;
  toAddress: string;
}

function determineBridgeRequirement(
  primary: NetworkId,
  target: NetworkId,
  context: RoutingContext
): PaymentRoute['bridgePath'] | undefined {
  if (primary === target) return undefined;

  const bridgeContract = getBridgeContract(primary, target);
  if (!bridgeContract) return undefined;

  // In production: check liquidity pools, estimate bridge time
  return {
    sourceNetwork: primary,
    targetNetwork: target,
    bridgeContract,
    estimatedBridgeTimeSeconds: 600 + Math.random() * 1200, // 10-30 min
    bridgeFeeUsd: context.amountUsd * 0.001 + 2, // 0.1% + $2 base
  };
}

function filterExcludedNetworks(
  scores: RouteScore[],
  excluded?: NetworkId[]
): RouteScore[] {
  if (!excluded || excluded.length === 0) return scores;
  return scores.filter((s) => !excluded.includes(s.networkId));
}

function applyPreferredNetworks(
  scores: RouteScore[],
  preferred?: NetworkId[]
): RouteScore[] {
  if (!preferred || preferred.length === 0) return scores;

  // Boost preferred networks slightly
  return scores.map((s) => ({
    ...s,
    compositeScore: preferred.includes(s.networkId)
      ? s.compositeScore * 0.85 // 15% boost
      : s.compositeScore,
  })).sort((a, b) => a.compositeScore - b.compositeScore);
}

function checkMaxFeeConstraint(
  scores: RouteScore[],
  maxFeeUsd?: number
): RouteScore[] {
  if (!maxFeeUsd) return scores;
  return scores.filter((s) => s.estimatedFeeUsd <= maxFeeUsd);
}

export async function calculateOptimalRoute(
  context: RoutingContext,
  preferences: UserPreferences,
  metrics: NetworkMetrics[]
): Promise<PaymentRoute> {
  let scores = scoreAllNetworks(metrics, preferences);

  // Apply user preferences
  scores = filterExcludedNetworks(scores, preferences.excludedNetworks);
  scores = applyPreferredNetworks(scores, preferences.preferredNetworks);
  scores = checkMaxFeeConstraint(scores, preferences.maxFeeUsd);

  // Filter out degraded/down networks
  const networkStatuses = await Promise.all(
    scores.map((s) => getNetworkStatus(s.networkId))
  );
  const operationalScores = scores.filter((_, i) =>
    networkStatuses[i].status !== 'down'
  );

  if (operationalScores.length === 0) {
    throw new Error('No operational networks available for routing');
  }

  const primary = operationalScores[0];
  const fallbacks = operationalScores.slice(1, 4).map((s) => s.networkId);

  // Check if bridging is needed for liquidity
  const hasLiquidity = await checkLiquidity(primary.networkId, context);
  let bridgePath: PaymentRoute['bridgePath'] | undefined;

  if (!hasLiquidity && fallbacks.length > 0) {
    // Try to bridge from primary to first fallback with liquidity
    for (const fallback of fallbacks) {
      const hasFbLiquidity = await checkLiquidity(fallback, context);
      if (hasFbLiquidity) {
        bridgePath = determineBridgeRequirement(primary.networkId, fallback, context);
        if (bridgePath) break;
      }
    }
  }

  const scoresMap = Object.fromEntries(
    scores.map((s) => [s.networkId, s])
  ) as Record<NetworkId, RouteScore>;

  return {
    primary: primary.networkId,
    fallbacks,
    bridgeRequired: !!bridgePath,
    bridgePath,
    scores: scoresMap,
    recommended: primary.networkId,
    userOverridden: false,
  };
}

// Simulated liquidity check — replace with actual DEX/pool queries
async function checkLiquidity(networkId: NetworkId, context: RoutingContext): Promise<boolean> {
  // In production: query DEX liquidity pools, bridge liquidity, etc.
  // Simulate 95% liquidity availability
  return Math.random() > 0.05;
}

export async function executeWithFallback(
  route: PaymentRoute,
  executeFn: (networkId: NetworkId) => Promise<string>,
  onFallback?: (from: NetworkId, to: NetworkId, error: Error) => void
): Promise<{ txHash: string; networkUsed: NetworkId; attempts: number }> {
  const networksToTry = [route.primary, ...route.fallbacks];
  let lastError: Error | undefined;

  for (let i = 0; i < networksToTry.length; i++) {
    const networkId = networksToTry[i];
    try {
      const txHash = await executeFn(networkId);
      return { txHash, networkUsed: networkId, attempts: i + 1 };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (onFallback && i < networksToTry.length - 1) {
        onFallback(networkId, networksToTry[i + 1], lastError);
      }
    }
  }

  throw new Error(
    `All routing attempts failed. Tried: ${networksToTry.join(', ')}. Last error: ${lastError?.message}`
  );
}