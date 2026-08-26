export type NetworkId = 'stellar' | 'ethereum' | 'polygon' | 'arbitrum' | 'optimism';

export interface NetworkHealth {
  status: 'healthy' | 'degraded' | 'down';
  lastChecked: number;
  blockHeight: number;
  avgLatencyMs: number;
  errorRate24h: number;
  uptime7d: number;
}

export interface NetworkRoute {
  network: NetworkId;
  cost: number;
  speedMs: number;
  reliability: number;
  minAmount: number;
  maxAmount: number;
  supportedAssets: string[];
  features: string[];
}

export class NetworkRegistry {
  private health = new Map<NetworkId, NetworkHealth>();
  private routes = new Map<NetworkId, NetworkRoute>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    const now = Date.now();
    this.health.set('stellar', { status: 'healthy', lastChecked: now, blockHeight: 0, avgLatencyMs: 45, errorRate24h: 0.001, uptime7d: 99.99 });
    this.health.set('ethereum', { status: 'healthy', lastChecked: now, blockHeight: 0, avgLatencyMs: 120, errorRate24h: 0.005, uptime7d: 99.95 });
    this.health.set('polygon', { status: 'healthy', lastChecked: now, blockHeight: 0, avgLatencyMs: 25, errorRate24h: 0.003, uptime7d: 99.9 });
    this.health.set('arbitrum', { status: 'healthy', lastChecked: now, blockHeight: 0, avgLatencyMs: 15, errorRate24h: 0.002, uptime7d: 99.97 });
    this.health.set('optimism', { status: 'healthy', lastChecked: now, blockHeight: 0, avgLatencyMs: 18, errorRate24h: 0.004, uptime7d: 99.92 });

    this.routes.set('stellar', { network: 'stellar', cost: 0.00001, speedMs: 45, reliability: 0.9999, minAmount: 0.00001, maxAmount: 1_000_000, supportedAssets: ['XLM', 'USDC'], features: ['escrow', 'x402', 'soroban'] });
    this.routes.set('ethereum', { network: 'ethereum', cost: 0.5, speedMs: 12000, reliability: 0.9995, minAmount: 0.001, maxAmount: 100_000, supportedAssets: ['ETH', 'USDC', 'DAI'], features: ['escrow', 'htlc', 'evm'] });
    this.routes.set('polygon', { network: 'polygon', cost: 0.001, speedMs: 2000, reliability: 0.999, minAmount: 0.001, maxAmount: 500_000, supportedAssets: ['MATIC', 'USDC', 'DAI'], features: ['escrow', 'evm'] });
    this.routes.set('arbitrum', { network: 'arbitrum', cost: 0.002, speedMs: 250, reliability: 0.9997, minAmount: 0.001, maxAmount: 200_000, supportedAssets: ['ETH', 'USDC'], features: ['escrow', 'evm'] });
    this.routes.set('optimism', { network: 'optimism', cost: 0.003, speedMs: 300, reliability: 0.9992, minAmount: 0.001, maxAmount: 200_000, supportedAssets: ['ETH', 'USDC'], features: ['escrow', 'evm'] });
  }

  getHealth(network: NetworkId): NetworkHealth | undefined {
    return this.health.get(network);
  }

  getRoute(network: NetworkId): NetworkRoute | undefined {
    return this.routes.get(network);
  }

  listNetworks(): NetworkId[] {
    return Array.from(this.health.keys());
  }

  listHealthyNetworks(): NetworkId[] {
    return Array.from(this.health.entries())
      .filter(([, h]) => h.status === 'healthy')
      .map(([n]) => n);
  }

  updateHealth(network: NetworkId, health: Partial<NetworkHealth>): void {
    const existing = this.health.get(network);
    if (existing) {
      this.health.set(network, { ...existing, ...health, lastChecked: Date.now() });
    }
  }

  registerRoute(route: NetworkRoute): void {
    this.routes.set(route.network, route);
    if (!this.health.has(route.network)) {
      this.health.set(route.network, { status: 'healthy', lastChecked: Date.now(), blockHeight: 0, avgLatencyMs: 0, errorRate24h: 0, uptime7d: 100 });
    }
  }

  getRouteStats(): Record<NetworkId, { route: NetworkRoute; health: NetworkHealth }> {
    const stats: Record<string, { route: NetworkRoute; health: NetworkHealth }> = {};
    for (const [network, route] of this.routes) {
      const health = this.health.get(network);
      if (health) stats[network] = { route, health };
    }
    return stats;
  }
}

export const networkRegistry = new NetworkRegistry();
