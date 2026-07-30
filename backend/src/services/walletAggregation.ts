/**
 * walletAggregation.ts — Issue #593
 *
 * Cross-chain wallet abstraction service.
 * Provides unified balance view, transaction history aggregation,
 * gas abstraction, and chain-agnostic payment routing across
 * Stellar and EVM-compatible networks.
 */

import { randomUUID } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChainType = 'stellar' | 'ethereum' | 'polygon' | 'base' | 'arbitrum' | 'optimism';
export type AssetType = 'native' | 'token' | 'stellar_asset';
export type TxStatus = 'pending' | 'confirmed' | 'failed';
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

export interface WalletBalance {
  chainId: string;
  chainType: ChainType;
  address: string;
  nativeBalance: string; // human-readable
  nativeBalanceRaw: string; // wei / stroops
  nativeBalanceUSD: number;
  tokens: TokenBalance[];
  lastUpdated: string;
}

export interface TokenBalance {
  contractAddress?: string;
  issuer?: string; // Stellar asset issuer
  assetCode: string;
  assetType: AssetType;
  balance: string;
  balanceRaw: string;
  balanceUSD: number;
  decimals: number;
  logoUrl?: string;
}

export interface AggregatedBalance {
  totalUSD: number;
  chains: WalletBalance[];
  topAssets: TokenBalance[];
  lastUpdated: string;
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
  feePayCurrency?: string; // gas abstraction: which token pays fees
  status: TxStatus;
  txHashes: Record<string, string>; // chainId → txHash
  bridgeProtocol?: string;
  estimatedTimeMs?: number;
  createdAt: string;
  confirmedAt?: string;
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

export interface WalletConnection {
  id: string;
  userId: string;
  chainType: ChainType;
  address: string;
  providerName: string; // 'freighter', 'metamask', 'walletconnect', 'web3auth'
  connectedAt: string;
  lastUsedAt: string;
  isActive: boolean;
}

// ─── Supported chains ─────────────────────────────────────────────────────────

export const SUPPORTED_CHAINS: Record<ChainType, ChainConfig> = {
  stellar: {
    chainId: 'stellar-testnet',
    chainType: 'stellar',
    name: 'Stellar',
    nativeCurrency: 'Lumen',
    nativeCurrencySymbol: 'XLM',
    nativeDecimals: 7,
    rpcUrl: 'https://horizon-testnet.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/testnet',
    isTestnet: true,
    avgConfirmationTimeMs: 5_000,
  },
  ethereum: {
    chainId: '1',
    chainType: 'ethereum',
    name: 'Ethereum',
    nativeCurrency: 'Ether',
    nativeCurrencySymbol: 'ETH',
    nativeDecimals: 18,
    rpcUrl: 'https://cloudflare-eth.com',
    explorerUrl: 'https://etherscan.io',
    isTestnet: false,
    avgConfirmationTimeMs: 15_000,
  },
  polygon: {
    chainId: '137',
    chainType: 'polygon',
    name: 'Polygon',
    nativeCurrency: 'MATIC',
    nativeCurrencySymbol: 'MATIC',
    nativeDecimals: 18,
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    isTestnet: false,
    avgConfirmationTimeMs: 2_000,
  },
  base: {
    chainId: '8453',
    chainType: 'base',
    name: 'Base',
    nativeCurrency: 'Ether',
    nativeCurrencySymbol: 'ETH',
    nativeDecimals: 18,
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    isTestnet: false,
    avgConfirmationTimeMs: 2_000,
  },
  arbitrum: {
    chainId: '42161',
    chainType: 'arbitrum',
    name: 'Arbitrum One',
    nativeCurrency: 'Ether',
    nativeCurrencySymbol: 'ETH',
    nativeDecimals: 18,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
    isTestnet: false,
    avgConfirmationTimeMs: 1_000,
  },
  optimism: {
    chainId: '10',
    chainType: 'optimism',
    name: 'Optimism',
    nativeCurrency: 'Ether',
    nativeCurrencySymbol: 'ETH',
    nativeDecimals: 18,
    rpcUrl: 'https://mainnet.optimism.io',
    explorerUrl: 'https://optimistic.etherscan.io',
    isTestnet: false,
    avgConfirmationTimeMs: 1_000,
  },
};

// ─── In-memory stores ─────────────────────────────────────────────────────────

const walletConnections = new Map<string, WalletConnection>();
const transactions = new Map<string, CrossChainTransaction>();

// ─── Service ──────────────────────────────────────────────────────────────────

export class WalletAggregationService {
  /**
   * Get supported chains list.
   */
  static getSupportedChains(): ChainConfig[] {
    return Object.values(SUPPORTED_CHAINS);
  }

  /**
   * Register a wallet connection for a user.
   */
  static connectWallet(
    userId: string,
    chainType: ChainType,
    address: string,
    providerName: string,
  ): WalletConnection {
    const existing = Array.from(walletConnections.values()).find(
      (w) => w.userId === userId && w.chainType === chainType && w.address.toLowerCase() === address.toLowerCase(),
    );

    if (existing) {
      existing.lastUsedAt = new Date().toISOString();
      existing.isActive = true;
      walletConnections.set(existing.id, existing);
      return existing;
    }

    const connection: WalletConnection = {
      id: `wallet_${randomUUID()}`,
      userId,
      chainType,
      address,
      providerName,
      connectedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      isActive: true,
    };
    walletConnections.set(connection.id, connection);
    return connection;
  }

  /**
   * Disconnect a wallet.
   */
  static disconnectWallet(connectionId: string): boolean {
    const conn = walletConnections.get(connectionId);
    if (!conn) return false;
    conn.isActive = false;
    walletConnections.set(connectionId, conn);
    return true;
  }

  /**
   * Get all wallet connections for a user.
   */
  static getUserWallets(userId: string): WalletConnection[] {
    return Array.from(walletConnections.values()).filter(
      (w) => w.userId === userId && w.isActive,
    );
  }

  /**
   * Get aggregated balance across all chains for a user.
   * In production, this would call Horizon, Alchemy/Infura, etc.
   */
  static async getAggregatedBalance(userId: string): Promise<AggregatedBalance> {
    const userWallets = this.getUserWallets(userId);
    const chainBalances: WalletBalance[] = [];

    for (const wallet of userWallets) {
      // Simulated balances — wire to real RPC providers in production
      const balance = await this._fetchChainBalance(wallet.chainType, wallet.address);
      chainBalances.push(balance);
    }

    const totalUSD = chainBalances.reduce((sum, b) => sum + b.nativeBalanceUSD, 0) +
      chainBalances.reduce((sum, b) => sum + b.tokens.reduce((ts, t) => ts + t.balanceUSD, 0), 0);

    // Aggregate top assets across all chains
    const assetMap = new Map<string, TokenBalance>();
    for (const chain of chainBalances) {
      for (const token of chain.tokens) {
        const key = token.assetCode;
        if (assetMap.has(key)) {
          const existing = assetMap.get(key)!;
          existing.balanceUSD += token.balanceUSD;
        } else {
          assetMap.set(key, { ...token });
        }
      }
    }
    const topAssets = Array.from(assetMap.values())
      .sort((a, b) => b.balanceUSD - a.balanceUSD)
      .slice(0, 10);

    return {
      totalUSD: Number(totalUSD.toFixed(2)),
      chains: chainBalances,
      topAssets,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Get optimal routes for a cross-chain transfer.
   */
  static getRoutes(
    sourceChain: ChainType,
    destinationChain: ChainType,
    amount: string,
  ): RouteOption[] {
    if (sourceChain === destinationChain) return [];

    const routes: RouteOption[] = [];
    const strategies: RoutingStrategy[] = ['cheapest', 'fastest', 'safest'];

    const destConfig = SUPPORTED_CHAINS[destinationChain];

    strategies.forEach((strategy) => {
      let feeUSD = 0;
      let timeMs = 0;
      let bridgeProtocol = '';

      switch (strategy) {
        case 'cheapest':
          feeUSD = 0.5;
          timeMs = 300_000; // 5 min
          bridgeProtocol = 'layerzero';
          break;
        case 'fastest':
          feeUSD = 3.0;
          timeMs = destConfig.avgConfirmationTimeMs * 2;
          bridgeProtocol = 'across';
          break;
        case 'safest':
          feeUSD = 1.5;
          timeMs = 60_000; // 1 min
          bridgeProtocol = 'stargate';
          break;
      }

      routes.push({
        sourceChain,
        destinationChain,
        bridgeProtocol,
        estimatedFeeUSD: feeUSD,
        estimatedTimeMs: timeMs,
        strategy,
        recommended: strategy === 'cheapest',
      });
    });

    return routes;
  }

  /**
   * Initiate a cross-chain transfer.
   */
  static async initiateCrossChainTransfer(params: {
    userId: string;
    sourceChain: ChainType;
    destinationChain: ChainType;
    sourceAddress: string;
    destinationAddress: string;
    assetCode: string;
    amount: string;
    feePayCurrency?: string;
    strategy?: RoutingStrategy;
  }): Promise<CrossChainTransaction> {
    const routes = this.getRoutes(params.sourceChain, params.destinationChain, params.amount);
    const strategy = params.strategy ?? 'cheapest';
    const route = routes.find((r) => r.strategy === strategy) ?? routes[0];

    const tx: CrossChainTransaction = {
      id: `xchain_${randomUUID()}`,
      sourceChain: params.sourceChain,
      destinationChain: params.destinationChain,
      sourceAddress: params.sourceAddress,
      destinationAddress: params.destinationAddress,
      assetCode: params.assetCode,
      amount: params.amount,
      amountUSD: parseFloat(params.amount) * 0.11, // approximate XLM price
      fee: route?.estimatedFeeUSD.toString() ?? '0',
      feeUSD: route?.estimatedFeeUSD ?? 0,
      feePayCurrency: params.feePayCurrency,
      status: 'pending',
      txHashes: {},
      bridgeProtocol: route?.bridgeProtocol,
      estimatedTimeMs: route?.estimatedTimeMs,
      createdAt: new Date().toISOString(),
    };

    transactions.set(tx.id, tx);
    return tx;
  }

  /**
   * Get transaction by ID.
   */
  static getTransaction(txId: string): CrossChainTransaction | null {
    return transactions.get(txId) ?? null;
  }

  /**
   * Get transaction history for a user (all chains).
   */
  static getTransactionHistory(userId: string, limit = 50): CrossChainTransaction[] {
    const userWallets = this.getUserWallets(userId);
    const userAddresses = new Set(userWallets.map((w) => w.address.toLowerCase()));

    return Array.from(transactions.values())
      .filter(
        (tx) =>
          userAddresses.has(tx.sourceAddress.toLowerCase()) ||
          userAddresses.has(tx.destinationAddress.toLowerCase()),
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  /**
   * Update transaction status (called by bridge webhook or polling).
   */
  static updateTransactionStatus(
    txId: string,
    status: TxStatus,
    txHash?: string,
    chainId?: string,
  ): CrossChainTransaction {
    const tx = transactions.get(txId);
    if (!tx) throw new Error(`Transaction not found: ${txId}`);

    tx.status = status;
    if (txHash && chainId) tx.txHashes[chainId] = txHash;
    if (status === 'confirmed') tx.confirmedAt = new Date().toISOString();

    transactions.set(txId, tx);
    return tx;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Fetch balance for a wallet on a specific chain.
   * In production: call Horizon for Stellar, Alchemy/Infura for EVM.
   */
  private static async _fetchChainBalance(chainType: ChainType, address: string): Promise<WalletBalance> {
    const chain = SUPPORTED_CHAINS[chainType];
    const now = new Date().toISOString();

    // Simulated data — replace with real RPC calls in production
    const nativeBalanceMap: Record<ChainType, number> = {
      stellar: 1_250.5,
      ethereum: 0.42,
      polygon: 850,
      base: 0.18,
      arbitrum: 0.25,
      optimism: 0.31,
    };

    const usdPrices: Record<ChainType, number> = {
      stellar: 0.11,
      ethereum: 3_200,
      polygon: 0.95,
      base: 3_200,
      arbitrum: 3_200,
      optimism: 3_200,
    };

    const nativeBalance = nativeBalanceMap[chainType] ?? 0;
    const usdPrice = usdPrices[chainType] ?? 0;

    const tokens: TokenBalance[] = chainType === 'stellar'
      ? [
          { assetCode: 'USDC', assetType: 'stellar_asset', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', balance: '250.00', balanceRaw: '2500000000', balanceUSD: 250, decimals: 7 },
          { assetCode: 'yXLM', assetType: 'stellar_asset', issuer: 'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55', balance: '500.00', balanceRaw: '5000000000', balanceUSD: 55, decimals: 7 },
        ]
      : [
          { assetCode: 'USDC', assetType: 'token', contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', balance: '100.00', balanceRaw: '100000000', balanceUSD: 100, decimals: 6 },
        ];

    return {
      chainId: chain.chainId,
      chainType,
      address,
      nativeBalance: nativeBalance.toString(),
      nativeBalanceRaw: (nativeBalance * Math.pow(10, chain.nativeDecimals)).toString(),
      nativeBalanceUSD: Number((nativeBalance * usdPrice).toFixed(2)),
      tokens,
      lastUpdated: now,
    };
  }
}
