import * as StellarSdk from '@stellar/stellar-sdk';
import { config } from '../config/env.js';
import type { RelayerHealth, GasEstimate } from './types.js';

const NETWORK = config().STELLAR_NETWORK;
const HORIZON_URL =
  NETWORK === 'public'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';

const server = new StellarSdk.Horizon.Server(HORIZON_URL);

// Relayer fee on top of base network fee (in stroops, 1 XLM = 10_000_000 stroops)
const RELAYER_FEE_STROOPS = 100; // 0.00001 XLM
const BASE_FEE_STROOPS = 100;    // Stellar minimum base fee

let healthCache: { data: RelayerHealth; fetchedAt: number } | null = null;
const HEALTH_CACHE_TTL_MS = 30_000; // 30 seconds

export async function getRelayerHealth(relayerAddress?: string): Promise<RelayerHealth> {
  const now = Date.now();
  if (healthCache && now - healthCache.fetchedAt < HEALTH_CACHE_TTL_MS) {
    return healthCache.data;
  }

  if (!relayerAddress || !StellarSdk.StrKey.isValidEd25519PublicKey(relayerAddress)) {
    const health: RelayerHealth = {
      status: 'unavailable',
      balance: '0',
      pendingTxCount: 0,
      lastCheckedAt: new Date().toISOString(),
    };
    return health;
  }

  try {
    const account = await server.loadAccount(relayerAddress);
    const xlmBalance = account.balances.find((b) => b.asset_type === 'native');
    const balance = xlmBalance?.balance ?? '0';
    const balanceNum = parseFloat(balance);

    const status: RelayerHealth['status'] =
      balanceNum >= 1 ? 'healthy' : balanceNum > 0 ? 'degraded' : 'unavailable';

    const health: RelayerHealth = {
      status,
      balance,
      pendingTxCount: 0,
      lastCheckedAt: new Date().toISOString(),
    };

    healthCache = { data: health, fetchedAt: now };
    return health;
  } catch {
    const health: RelayerHealth = {
      status: 'unavailable',
      balance: '0',
      pendingTxCount: 0,
      lastCheckedAt: new Date().toISOString(),
    };
    return health;
  }
}

export function estimateGas(): GasEstimate {
  const totalStroops = BASE_FEE_STROOPS + RELAYER_FEE_STROOPS;
  const stroopsToXlm = (s: number) => (s / 10_000_000).toFixed(7);

  return {
    baseFee: stroopsToXlm(BASE_FEE_STROOPS),
    relayerFee: stroopsToXlm(RELAYER_FEE_STROOPS),
    totalFee: stroopsToXlm(totalStroops),
    currency: 'XLM',
  };
}
