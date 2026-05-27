import { NetworkId, NetworkMetrics, NetworkStatus } from './types';
import { getAllNetworkIds, getNetworkConfig } from './network-registry';

const GAS_PRICE_CACHE = new Map<NetworkId, { price: number; timestamp: number }>();
const STATUS_CACHE = new Map<NetworkId, NetworkStatus>();
const CACHE_TTL_MS = 30000; // 30 seconds

// Simulated gas price fetchers — replace with actual RPC calls in production
async function fetchGasPrice(networkId: NetworkId): Promise<number> {
  const cached = GAS_PRICE_CACHE.get(networkId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.price;
  }

  // In production: call eth_gasPrice via RPC
  // Simulated values for demonstration
  const simulatedPrices: Record<NetworkId, number> = {
    ethereum: 25 + Math.random() * 50,
    polygon: 50 + Math.random() * 200,
    arbitrum: 0.1 + Math.random() * 0.5,
    optimism: 0.05 + Math.random() * 0.3,
    base: 0.05 + Math.random() * 0.2,
    avalanche: 25 + Math.random() * 75,
    bnb: 3 + Math.random() * 10,
  };

  const price = simulatedPrices[networkId];
  GAS_PRICE_CACHE.set(networkId, { price, timestamp: Date.now() });
  return price;
}

async function fetchBlockTime(networkId: NetworkId): Promise<number> {
  const config = getNetworkConfig(networkId);
  // In production: calculate from recent blocks
  return config.blockTimeTarget * (0.8 + Math.random() * 0.4);
}

async function fetchReliability(networkId: NetworkId): Promise<number> {
  // In production: analyze historical success rates from database
  const baseReliability: Record<NetworkId, number> = {
    ethereum: 99.5,
    polygon: 97.0,
    arbitrum: 98.5,
    optimism: 98.0,
    base: 99.0,
    avalanche: 96.5,
    bnb: 95.0,
  };
  return baseReliability[networkId] + (Math.random() - 0.5) * 2;
}

function calculateCongestion(gasPrice: number, networkId: NetworkId): NetworkMetrics['congestionLevel'] {
  const config = getNetworkConfig(networkId);
  const ratio = gasPrice / config.maxGasPriceGwei;

  if (ratio < 0.1) return 'low';
  if (ratio < 0.3) return 'medium';
  if (ratio < 0.6) return 'high';
  return 'critical';
}

export async function getNetworkMetrics(networkId: NetworkId): Promise<NetworkMetrics> {
  const [gasPrice, blockTime, reliability] = await Promise.all([
    fetchGasPrice(networkId),
    fetchBlockTime(networkId),
    fetchReliability(networkId),
  ]);

  return {
    networkId,
    gasPriceGwei: gasPrice,
    blockTimeSeconds: blockTime,
    reliabilityScore: reliability,
    congestionLevel: calculateCongestion(gasPrice, networkId),
    lastBlockTimestamp: Date.now(),
    failedTxCount24h: Math.floor(Math.random() * 100),
    totalTxCount24h: Math.floor(Math.random() * 100000) + 10000,
  };
}

export async function getAllNetworkMetrics(): Promise<NetworkMetrics[]> {
  const networks = getAllNetworkIds();
  return Promise.all(networks.map(getNetworkMetrics));
}

export async function getNetworkStatus(networkId: NetworkId): Promise<NetworkStatus> {
  const cached = STATUS_CACHE.get(networkId);
  if (cached && Date.now() - cached.lastUpdated < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const metrics = await getNetworkMetrics(networkId);
    const status: NetworkStatus = {
      networkId,
      status: metrics.congestionLevel === 'critical' && metrics.reliabilityScore < 90
        ? 'degraded'
        : 'operational',
      lastUpdated: Date.now(),
    };
    STATUS_CACHE.set(networkId, status);
    return status;
  } catch {
    const status: NetworkStatus = {
      networkId,
      status: 'down',
      lastUpdated: Date.now(),
    };
    STATUS_CACHE.set(networkId, status);
    return status;
  }
}

export async function getAllNetworkStatuses(): Promise<NetworkStatus[]> {
  const networks = getAllNetworkIds();
  return Promise.all(networks.map(getNetworkStatus));
}