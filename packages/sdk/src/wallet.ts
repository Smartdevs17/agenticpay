/**
 * wallet.ts (SDK) — Issue #711
 *
 * Client surface for the cross-chain wallet abstraction API. Exposes a single
 * chain-agnostic interface for connecting wallets, reading unified balances,
 * and routing/initiating cross-chain transfers, so SDK consumers don't need
 * to hand-roll `fetch()` calls against `/wallet/*` (as `web3Store.ts` used to).
 */

import { AgenticPayClient } from './client.js';

export type ChainType = 'stellar' | 'ethereum' | 'polygon' | 'base' | 'arbitrum' | 'optimism';
export type AssetType = 'native' | 'token' | 'stellar_asset';
export type WalletTxStatus = 'pending' | 'confirmed' | 'failed';
export type RoutingStrategy = 'cheapest' | 'fastest' | 'safest';

export interface ChainConfig {
  chainId: string;
  chainType: ChainType;
  name: string;
  nativeCurrency: string;
  nativeCurrencySymbol: string;
  nativeDecimals: number;
  rpcUrl: string;
  explorerUrl: string;
  isTestnet: boolean;
  avgConfirmationTimeMs: number;
}

export interface TokenBalance {
  contractAddress?: string;
  issuer?: string;
  assetCode: string;
  assetType: AssetType;
  balance: string;
  balanceRaw: string;
  balanceUSD: number;
  decimals: number;
  logoUrl?: string;
}

export interface WalletBalance {
  chainId: string;
  chainType: ChainType;
  address: string;
  nativeBalance: string;
  nativeBalanceRaw: string;
  nativeBalanceUSD: number;
  tokens: TokenBalance[];
  lastUpdated: string;
}

export interface AggregatedBalance {
  totalUSD: number;
  chains: WalletBalance[];
  topAssets: TokenBalance[];
  lastUpdated: string;
}

export interface WalletConnection {
  id: string;
  userId: string;
  chainType: ChainType;
  address: string;
  providerName: string;
  connectedAt: string;
  lastUsedAt: string;
  isActive: boolean;
}

export interface RouteOption {
  sourceChain: ChainType;
  destinationChain: ChainType;
  bridgeProtocol: string;
  estimatedFeeUSD: number;
  estimatedTimeMs: number;
  strategy: RoutingStrategy;
  recommended: boolean;
}

export interface CrossChainTransaction {
  id: string;
  sourceChain: ChainType;
  destinationChain: ChainType;
  sourceAddress: string;
  destinationAddress: string;
  assetCode: string;
  amount: string;
  amountUSD: number;
  fee: string;
  feeUSD: number;
  feePayCurrency?: string;
  status: WalletTxStatus;
  txHashes: Record<string, string>;
  bridgeProtocol?: string;
  estimatedTimeMs?: number;
  createdAt: string;
  confirmedAt?: string;
}

export interface ConnectWalletInput {
  userId: string;
  chainType: ChainType;
  address: string;
  providerName: string;
}

export interface InitiateTransferInput {
  userId?: string;
  sourceChain: ChainType;
  destinationChain: ChainType;
  sourceAddress: string;
  destinationAddress: string;
  assetCode: string;
  amount: string;
  feePayCurrency?: string;
  strategy?: RoutingStrategy;
}

type ApiEnvelope<T> = { success: boolean; data: T; count?: number };

/**
 * A minimal, chain-agnostic contract that any wallet connector (EVM
 * injected/WalletConnect, Stellar Freighter, etc.) can implement so the rest
 * of the app talks to one shape regardless of chain.
 */
export interface WalletAdapter {
  readonly chainType: ChainType;
  readonly providerName: string;
  isAvailable(): boolean;
  connect(): Promise<{ address: string }>;
  disconnect(): Promise<void>;
  getAddress(): string | null;
}

export class WalletApi {
  constructor(private readonly client: AgenticPayClient) {}

  /** List all chains this wallet abstraction layer supports. */
  async getSupportedChains(): Promise<ChainConfig[]> {
    const res = await this.client.get<ApiEnvelope<ChainConfig[]>>('/wallet/chains');
    return res.data;
  }

  /** Register a connected wallet (EVM or Stellar) against a user. */
  async connectWallet(input: ConnectWalletInput): Promise<WalletConnection> {
    const res = await this.client.post<ApiEnvelope<WalletConnection>>('/wallet/connect', input);
    return res.data;
  }

  /** Disconnect a previously registered wallet connection. */
  disconnectWallet(connectionId: string) {
    return this.client.delete(`/wallet/${connectionId}`);
  }

  /** List a user's connected wallets across all chains. */
  async getConnections(userId: string): Promise<WalletConnection[]> {
    const res = await this.client.get<ApiEnvelope<WalletConnection[]>>(
      `/wallet/connections?userId=${encodeURIComponent(userId)}`,
    );
    return res.data;
  }

  /** Unified balance across every chain the user has connected. */
  async getAggregatedBalance(userId: string): Promise<AggregatedBalance> {
    const res = await this.client.get<ApiEnvelope<AggregatedBalance>>(
      `/wallet/aggregated?userId=${encodeURIComponent(userId)}`,
    );
    return res.data;
  }

  /** Available bridge/transfer routes between two chains. */
  async getRoutes(source: ChainType, destination: ChainType, amount: string): Promise<RouteOption[]> {
    const query = new URLSearchParams({ source, destination, amount });
    const res = await this.client.get<ApiEnvelope<RouteOption[]>>(`/wallet/routes?${query.toString()}`);
    return res.data;
  }

  /** Initiate a cross-chain transfer using the given (or auto-selected) route. */
  async initiateTransfer(input: InitiateTransferInput): Promise<CrossChainTransaction> {
    const res = await this.client.post<ApiEnvelope<CrossChainTransaction>>('/wallet/transfer', input);
    return res.data;
  }

  /** Poll the status of an in-flight cross-chain transfer. */
  async getTransfer(id: string): Promise<CrossChainTransaction> {
    const res = await this.client.get<ApiEnvelope<CrossChainTransaction>>(`/wallet/transfer/${id}`);
    return res.data;
  }

  /** Unified transaction history across all connected chains. */
  async getHistory(userId: string, limit = 50): Promise<CrossChainTransaction[]> {
    const query = new URLSearchParams({ userId, limit: String(limit) });
    const res = await this.client.get<ApiEnvelope<CrossChainTransaction[]>>(`/wallet/history?${query.toString()}`);
    return res.data;
  }
}
