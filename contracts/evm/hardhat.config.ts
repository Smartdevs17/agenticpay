import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import * as dotenv from 'dotenv';

dotenv.config();

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

// Pulls the RPC URL for the given env key; falls back to a dummy URL so
// Hardhat can still parse the config when the network isn't configured.
// Attempting to actually use an unconfigured network will fail fast.
function rpc(envKey: string, fallback = 'https://unconfigured.invalid'): string {
  return process.env[envKey] ?? fallback;
}

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // via-IR slightly increases compile time but improves stack depth
      // handling for the upgrade-safety validators.
      viaIR: false,
    },
  },

  networks: {
    hardhat: {
      allowUnlimitedContractSize: false,
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
    },

    // ── Ethereum ──────────────────────────────────────────────────────
    mainnet: {
      url: rpc('MAINNET_RPC_URL'),
      chainId: 1,
      accounts,
    },
    sepolia: {
      url: rpc('SEPOLIA_RPC_URL'),
      chainId: 11155111,
      accounts,
    },

    // ── Polygon ───────────────────────────────────────────────────────
    polygon: {
      url: rpc('POLYGON_RPC_URL'),
      chainId: 137,
      accounts,
    },
    polygonAmoy: {
      url: rpc('POLYGON_AMOY_RPC_URL'),
      chainId: 80002,
      accounts,
    },

    // ── Arbitrum ──────────────────────────────────────────────────────
    arbitrum: {
      url: rpc('ARBITRUM_RPC_URL'),
      chainId: 42161,
      accounts,
    },
    arbitrumSepolia: {
      url: rpc('ARBITRUM_SEPOLIA_RPC_URL'),
      chainId: 421614,
      accounts,
    },

    // ── Optimism ──────────────────────────────────────────────────────
    optimism: {
      url: rpc('OPTIMISM_RPC_URL'),
      chainId: 10,
      accounts,
    },
    optimismSepolia: {
      url: rpc('OPTIMISM_SEPOLIA_RPC_URL'),
      chainId: 11155420,
      accounts,
    },

    // ── Base ──────────────────────────────────────────────────────────
    base: {
      url: rpc('BASE_RPC_URL'),
      chainId: 8453,
      accounts,
    },
    baseSepolia: {
      url: rpc('BASE_SEPOLIA_RPC_URL'),
      chainId: 84532,
      accounts,
    },
  },

  // Etherscan v2 exposes a unified endpoint, so a single ETHERSCAN_API_KEY
  // can verify across supported chains. Chain-specific keys override it.
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY ?? '',
      sepolia: process.env.ETHERSCAN_API_KEY ?? '',
      polygon: process.env.POLYGONSCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY ?? '',
      polygonAmoy: process.env.POLYGONSCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY ?? '',
      arbitrumOne: process.env.ARBISCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY ?? '',
      arbitrumSepolia: process.env.ARBISCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY ?? '',
      optimisticEthereum:
        process.env.OPTIMISTIC_ETHERSCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY ?? '',
      optimismSepolia:
        process.env.OPTIMISTIC_ETHERSCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY ?? '',
      base: process.env.BASESCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY ?? '',
      baseSepolia: process.env.BASESCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY ?? '',
    },
    customChains: [
      {
        network: 'polygonAmoy',
        chainId: 80002,
        urls: {
          apiURL: 'https://api-amoy.polygonscan.com/api',
          browserURL: 'https://amoy.polygonscan.com',
        },
      },
      {
        network: 'arbitrumSepolia',
        chainId: 421614,
        urls: {
          apiURL: 'https://api-sepolia.arbiscan.io/api',
          browserURL: 'https://sepolia.arbiscan.io',
        },
      },
      {
        network: 'optimismSepolia',
        chainId: 11155420,
        urls: {
          apiURL: 'https://api-sepolia-optimistic.etherscan.io/api',
          browserURL: 'https://sepolia-optimism.etherscan.io',
        },
      },
      {
        network: 'baseSepolia',
        chainId: 84532,
        urls: {
          apiURL: 'https://api-sepolia.basescan.org/api',
          browserURL: 'https://sepolia.basescan.org',
        },
      },
    ],
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    currency: 'USD',
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  },

  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },

  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },

  mocha: {
    timeout: 60_000,
  },
};

export default config;
