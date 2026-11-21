/**
 * packages/sdk-core/src/network.ts
 *
 * Network and RPC/Horizon client selection wrappers.
 * No network connections are initiated at module import time.
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import type { StellarNetwork } from './types.js';

export const HORIZON_URLS: Record<StellarNetwork, string> = {
  public: 'https://horizon.stellar.org',
  testnet: 'https://horizon-testnet.stellar.org',
};

export const SOROBAN_RPC_URLS: Record<StellarNetwork, string> = {
  public: 'https://mainnet.sorobanrpc.com',
  testnet: 'https://soroban-testnet.stellar.org',
};

export function getHorizonUrl(network: StellarNetwork = 'testnet'): string {
  return HORIZON_URLS[network] ?? HORIZON_URLS.testnet;
}

export function getSorobanRpcUrl(network: StellarNetwork = 'testnet'): string {
  return SOROBAN_RPC_URLS[network] ?? SOROBAN_RPC_URLS.testnet;
}

export function getNetworkPassphrase(network: StellarNetwork = 'testnet'): string {
  return network === 'public'
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;
}

export function createHorizonServer(
  urlOrNetwork: string | StellarNetwork = 'testnet',
  options: StellarSdk.Horizon.Server.Options = {}
): StellarSdk.Horizon.Server {
  const url =
    urlOrNetwork === 'public' || urlOrNetwork === 'testnet'
      ? getHorizonUrl(urlOrNetwork)
      : urlOrNetwork;

  return new StellarSdk.Horizon.Server(url, options);
}

export function createSorobanRpcServer(urlOrNetwork: string | StellarNetwork = 'testnet'): StellarSdk.SorobanRpc.Server {
  const url =
    urlOrNetwork === 'public' || urlOrNetwork === 'testnet'
      ? getSorobanRpcUrl(urlOrNetwork)
      : urlOrNetwork;

  return new StellarSdk.SorobanRpc.Server(url);
}
