export type SupportedChain = 'mainnet' | 'sepolia' | 'polygon' | 'arbitrum' | 'optimism' | 'base';

export interface ChainConfig {
  id: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  contracts: string[];
}

const CHAIN_CONFIGS: Record<SupportedChain, ChainConfig> = {
  mainnet: {
    id: 1,
    name: 'Ethereum Mainnet',
    rpcUrl: process.env.NEXT_PUBLIC_ETH_MAINNET_RPC || 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    contracts: ['AgentPay'],
  },
  sepolia: {
    id: 11155111,
    name: 'Sepolia Testnet',
    rpcUrl: process.env.NEXT_PUBLIC_SEPOLIA_RPC || 'https://rpc.sepolia.org',
    explorerUrl: 'https://sepolia.etherscan.io',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    contracts: ['AgentPay'],
  },
  polygon: {
    id: 137,
    name: 'Polygon',
    rpcUrl: process.env.NEXT_PUBLIC_POLYGON_RPC || 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    contracts: [],
  },
  arbitrum: {
    id: 42161,
    name: 'Arbitrum One',
    rpcUrl: process.env.NEXT_PUBLIC_ARBITRUM_RPC || 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    contracts: [],
  },
  optimism: {
    id: 10,
    name: 'Optimism',
    rpcUrl: process.env.NEXT_PUBLIC_OPTIMISM_RPC || 'https://mainnet.optimism.io',
    explorerUrl: 'https://optimistic.etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    contracts: [],
  },
  base: {
    id: 8453,
    name: 'Base',
    rpcUrl: process.env.NEXT_PUBLIC_BASE_RPC || 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    contracts: [],
  },
};

const chainConfigCache = new Map<SupportedChain, ChainConfig>();

export function getChainConfig(chain: SupportedChain): ChainConfig {
  if (!chainConfigCache.has(chain)) {
    chainConfigCache.set(chain, CHAIN_CONFIGS[chain]);
  }
  return chainConfigCache.get(chain)!;
}

export function getAllChainConfigs(): ChainConfig[] {
  return Object.values(CHAIN_CONFIGS);
}

export function preloadChainConfig(chain: SupportedChain): void {
  getChainConfig(chain);
}
