import { routeScorer, type RoutingPreference, type ScoredRoute } from './RouteScorer.js';
import { networkRegistry, type NetworkId } from './NetworkRegistry.js';

export interface RouteRequest {
  amount: number;
  fromAsset: string;
  toAsset?: string;
  fromNetwork?: NetworkId;
  toNetwork?: NetworkId;
  preference?: RoutingPreference;
  merchantId?: string;
}

export interface RouteResult {
  primary: ScoredRoute;
  fallbacks: ScoredRoute[];
  estimatedTotalCost: number;
  estimatedTotalTimeMs: number;
}

export class PaymentRouter {
  route(request: RouteRequest): RouteResult {
    const preference = request.preference ?? { prioritize: 'balanced' };
    const scored = routeScorer.scoreAll(preference);

    if (scored.length === 0) {
      throw new Error('No available route found for the given preferences');
    }

    const primary = scored[0];
    const fallbacks = scored.slice(1, 4);

    return {
      primary,
      fallbacks,
      estimatedTotalCost: primary.cost,
      estimatedTotalTimeMs: primary.estimatedTimeMs,
    };
  }

  async executeWithFallback(request: RouteRequest): Promise<{ route: ScoredRoute; txHash: string }> {
    const result = this.route(request);
    const routes = [result.primary, ...result.fallbacks];

    for (const route of routes) {
      try {
        const txHash = await this.submitViaRoute(route, request);
        return { route, txHash };
      } catch (err) {
        console.warn(`[Router] Route ${route.network} failed:`, err);
      }
    }

    throw new Error('All routes failed');
  }

  private async submitViaRoute(route: ScoredRoute, request: RouteRequest): Promise<string> {
    const simulated = `tx_${route.network}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    return simulated;
  }

  getRouteAnalytics(): { totalRoutes: number; healthyCount: number; networks: string[] } {
    const healthy = networkRegistry.listHealthyNetworks();
    return {
      totalRoutes: networkRegistry.listNetworks().length,
      healthyCount: healthy.length,
      networks: networkRegistry.listNetworks(),
    };
  }
}

export const paymentRouter = new PaymentRouter();
