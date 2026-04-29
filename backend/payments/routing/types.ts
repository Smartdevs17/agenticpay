export type NetworkId = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'base' | 'avalanche' | 'bnb';

export interface NetworkMetrics {
  networkId: NetworkId;
  gasPriceGwei: number;
  blockTimeSeconds: number;
  reliabilityScore: number; // 0-100
  congestionLevel: 'low' | 'medium' | 'high' | 'critical';
  lastBlockTimestamp: number;
  failedTxCount24h: number;
  totalTxCount24h: number;
}

export interface RouteScore {
  networkId: NetworkId;
  costScore: number;      // lower is better (normalized)
  speedScore: number;     // lower is better (normalized)
  reliabilityScore: number; // higher is better
  compositeScore: number;  // weighted combination
  estimatedFeeUsd: number;
  estimatedTimeSeconds: number;
}

export interface UserPreferences {
  priority: 'cost' | 'speed' | 'reliability';
  maxFeeUsd?: number;
  excludedNetworks?: NetworkId[];
  preferredNetworks?: NetworkId[];
}

export interface PaymentRoute {
  primary: NetworkId;
  fallbacks: NetworkId[];
  bridgeRequired: boolean;
  bridgePath?: {
    sourceNetwork: NetworkId;
    targetNetwork: NetworkId;
    bridgeContract: string;
    estimatedBridgeTimeSeconds: number;
    bridgeFeeUsd: number;
  };
  scores: Record<NetworkId, RouteScore>;
  recommended: NetworkId;
  userOverridden: boolean;
}

export interface RoutingDecision {
  id: string;
  timestamp: number;
  paymentId: string;
  selectedRoute: PaymentRoute;
  reason: string;
  userNotified: boolean;
}

export interface NetworkStatus {
  networkId: NetworkId;
  status: 'operational' | 'degraded' | 'down';
  lastUpdated: number;
}