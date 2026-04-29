import { NetworkId, NetworkMetrics, NetworkStatus } from './types';

export const NETWORK_REGISTRY: Record<NetworkId, {
  name: string;
  chainId: number;
  rpcUrls: string[];
  nativeCurrency: string;
  blockTimeTarget: number;
  maxGasPriceGwei: number;
  bridgeContracts: Partial<Record<NetworkId, string>>;
}> = {
  ethereum: {
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpcUrls: [
      'https://eth-mainnet.g.alchemy.com/v2/',
      'https://mainnet.infura.io/v3/',
    ],
    nativeCurrency: 'ETH',
    blockTimeTarget: 12,
    maxGasPriceGwei: 500,
    bridgeContracts: {
      polygon: '0xA0c68C638235ee32657e8f720a23ceC1bFc77C77', // Plasma Bridge
      arbitrum: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f', // Inbox
      optimism: '0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1', // L1StandardBridge
      base: '0x49048044D57e1C92A77f79988d21Fa8fAF74E97e', // Base Bridge
    },
  },
  polygon: {
    name: 'Polygon PoS',
    chainId: 137,
    rpcUrls: [
      'https://polygon-mainnet.g.alchemy.com/v2/',
      'https://polygon-rpc.com',
    ],
    nativeCurrency: 'MATIC',
    blockTimeTarget: 2,
    maxGasPriceGwei: 1000,
    bridgeContracts: {
      ethereum: '0xA0c68C638235ee32657e8f720a23ceC1bFc77C77',
    },
  },
  arbitrum: {
    name: 'Arbitrum One',
    chainId: 42161,
    rpcUrls: [
      'https://arb-mainnet.g.alchemy.com/v2/',
      'https://arb1.arbitrum.io/rpc',
    ],
    nativeCurrency: 'ETH',
    blockTimeTarget: 0.25,
    maxGasPriceGwei: 10,
    bridgeContracts: {
      ethereum: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
    },
  },
  optimism: {
    name: 'Optimism',
    chainId: 10,
    rpcUrls: [
      'https://opt-mainnet.g.alchemy.com/v2/',
      'https://mainnet.optimism.io',
    ],
    nativeCurrency: 'ETH',
    blockTimeTarget: 2,
    maxGasPriceGwei: 10,
    bridgeContracts: {
      ethereum: '0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1',
    },
  },
  base: {
    name: 'Base',
    chainId: 8453,
    rpcUrls: [
      'https://base-mainnet.g.alchemy.com/v2/',
      'https://mainnet.base.org',
    ],
    nativeCurrency: 'ETH',
    blockTimeTarget: 2,
    maxGasPriceGwei: 10,
    bridgeContracts: {
      ethereum: '0x49048044D57e1C92A77f79988d21Fa8fAF74E97e',
    },
  },
  avalanche: {
    name: 'Avalanche C-Chain',
    chainId: 43114,
    rpcUrls: [
      'https://avalanche-mainnet.infura.io/v3/',
      'https://api.avax.network/ext/bc/C/rpc',
    ],
    nativeCurrency: 'AVAX',
    blockTimeTarget: 2,
    maxGasPriceGwei: 500,
    bridgeContracts: {
      ethereum: '0xE57BfdE5a5a9BB51EDa87E4003084A10b0C6DbB4',
    },
  },
  bnb: {
    name: 'BNB Smart Chain',
    chainId: 56,
    rpcUrls: [
      'https://bsc-dataseed.binance.org',
      'https://bsc-mainnet.nodereal.io/v1/',
    ],
    nativeCurrency: 'BNB',
    blockTimeTarget: 3,
    maxGasPriceGwei: 10,
    bridgeContracts: {
      ethereum: '0xF0B5cD0b03F1b6a6c9c9c6F5c8B5cD0b03F1b6a',
    },
  },
};

export function getNetworkConfig(networkId: NetworkId) {
  return NETWORK_REGISTRY[networkId];
}

export function getAllNetworkIds(): NetworkId[] {
  return Object.keys(NETWORK_REGISTRY) as NetworkId[];
}

export function getBridgeContract(source: NetworkId, target: NetworkId): string | undefined {
  return NETWORK_REGISTRY[source].bridgeContracts[target];
}