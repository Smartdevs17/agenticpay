import { networkRegistry, type NetworkId } from './NetworkRegistry.js';

export interface RoutingPreference {
  prioritize: 'cost' | 'speed' | 'reliability' | 'balanced';
  maxCost?: number;
  maxLatencyMs?: number;
  minReliability?: number;
}

export interface ScoredRoute {
  network: NetworkId;
  score: number;
  cost: number;
  estimatedTimeMs: number;
  reliability: number;
}

export class RouteScorer {
  scoreAll(preference: RoutingPreference): ScoredRoute[] {
    const healthy = networkRegistry.listHealthyNetworks();
    const scored: ScoredRoute[] = [];

    for (const network of healthy) {
      const route = networkRegistry.getRoute(network);
      const health = networkRegistry.getHealth(network);
      if (!route || !health) continue;

      if (preference.maxCost && route.cost > preference.maxCost) continue;
      if (preference.maxLatencyMs && health.avgLatencyMs > preference.maxLatencyMs) continue;
      if (preference.minReliability && route.reliability < preference.minReliability) continue;

      const score = this.computeScore(route.cost, health.avgLatencyMs, route.reliability, preference);
      scored.push({ network, score, cost: route.cost, estimatedTimeMs: health.avgLatencyMs, reliability: route.reliability });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  private computeScore(cost: number, latencyMs: number, reliability: number, preference: RoutingPreference): number {
    const costNorm = 1 / (1 + cost);
    const speedNorm = 1 / (1 + latencyMs / 1000);
    const reliabilityNorm = reliability;

    switch (preference.prioritize) {
      case 'cost':
        return costNorm * 0.7 + speedNorm * 0.15 + reliabilityNorm * 0.15;
      case 'speed':
        return costNorm * 0.15 + speedNorm * 0.7 + reliabilityNorm * 0.15;
      case 'reliability':
        return costNorm * 0.15 + speedNorm * 0.15 + reliabilityNorm * 0.7;
      case 'balanced':
      default:
        return costNorm * 0.33 + speedNorm * 0.33 + reliabilityNorm * 0.34;
    }
  }

  pickBest(preference: RoutingPreference): ScoredRoute | null {
    const scored = this.scoreAll(preference);
    return scored[0] ?? null;
  }
}

export const routeScorer = new RouteScorer();
