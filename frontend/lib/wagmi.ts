import { createConfig, http, injected } from 'wagmi';
import { mainnet } from 'wagmi/chains';

// NOTE: Primary wallet integration will use Stellar/Freighter.
// wagmi config is kept as a minimal placeholder for Web3Auth compatibility.
export const wagmiConfig = createConfig({
  chains: [mainnet],
  connectors: [
    injected(),
  ],
  transports: {
    [mainnet.id]: http(),
  },
});
