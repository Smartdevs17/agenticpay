'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/lib/wagmi';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { OfflineProvider } from '@/components/offline/OfflineProvider';
import { Web3StoreProvider } from '@/components/providers/Web3StoreProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  useEffect(() => {
    if (!notificationsEnabled) return;

    const interval = setInterval(() => {
      const events = [
        'Transaction confirmed',
        'Project status change',
        'New invoice'
      ];
      const randomEvent = events[Math.floor(Math.random() * events.length)];
      toast(randomEvent);
    }, 10000);

    return () => clearInterval(interval);
  }, [notificationsEnabled]);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Web3StoreProvider>
          <OfflineProvider>
            {children}
            <Toaster />
            <button
              onClick={() => setNotificationsEnabled(!notificationsEnabled)}
              className="fixed bottom-4 right-4 z-50 px-3 py-1 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-md shadow-sm text-sm"
            >
              {notificationsEnabled ? 'Disable Notifications' : 'Enable Notifications'}
            </button>
          </OfflineProvider>
        </Web3StoreProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

