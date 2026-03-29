import { createConfig, http, injected } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';

// NOTE: Primary wallet integration will use Stellar/Freighter.
// wagmi config is kept as a minimal placeholder for Web3Auth compatibility.
export const wagmiConfig = createConfig({
  // 1. Added sepolia so the Network Switcher has options
  chains: [mainnet, sepolia],
  connectors: [
    injected(),
  ],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
  // 2. This is the magic line that fulfills "Auto-reconnect on page refresh"
  ssr: true, 
});