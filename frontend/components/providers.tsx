'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/lib/wagmi';
import { useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { OfflineProvider } from '@/components/offline/OfflineProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <OfflineProvider>
          {children}
          <Toaster />
        </OfflineProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

