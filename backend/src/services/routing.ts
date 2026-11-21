import { paymentRouter, networkRegistry, routeScorer } from '../payments/index.js';
import type { RouteRequest, RouteResult, RoutingPreference, ScoredRoute } from '../payments/index.js';
import type { NetworkId, NetworkRoute, NetworkHealth } from '../payments/index.js';

export async function findRoute(request: RouteRequest): Promise<RouteResult> {
  return paymentRouter.route(request);
}

export async function executeRoute(request: RouteRequest): Promise<{ route: ScoredRoute; txHash: string }> {
  return paymentRouter.executeWithFallback(request);
}

export function getNetworkRoutes(): Record<string, { route: NetworkRoute; health: NetworkHealth }> {
  return networkRegistry.getRouteStats();
}

export function updateNetworkHealth(network: NetworkId, health: Partial<NetworkHealth>): void {
  networkRegistry.updateHealth(network, health);
}

export function getRouteAnalytics() {
  return paymentRouter.getRouteAnalytics();
}

export function getRouteStrategies(): string[] {
  return ['cost', 'speed', 'reliability', 'balanced'];
}

export function getScoredRoutes(preference: RoutingPreference): ScoredRoute[] {
  return routeScorer.scoreAll(preference);
}
