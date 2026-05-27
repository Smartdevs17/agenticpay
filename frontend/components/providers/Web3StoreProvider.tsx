'use client';

import { useWeb3Sync } from '@/lib/hooks/useWeb3';

/**
 * Mounts the wagmi→Zustand sync bridge.
 * Must be rendered inside <WagmiProvider> + <QueryClientProvider>.
 * Renders no DOM — pure side-effect component.
 */
export function Web3StoreProvider({ children }: { children: React.ReactNode }) {
  useWeb3Sync();
  return <>{children}</>;
}
