'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/lib/wagmi';
import { useState, useEffect, LazyExoticComponent, Suspense as ReactSuspense, ReactNode } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { OfflineProvider } from '@/components/offline/OfflineProvider';
import { Web3StoreProvider } from '@/components/providers/Web3StoreProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 10,
        refetchOnWindowFocus: false,
        retry: 2,
      },
    },
  }));
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

export function LoadingPlaceholder({ 
  children, 
  skeleton,
  delay = 0
}: { 
  children: ReactNode;
  skeleton?: ReactNode;
  delay?: number;
}) {
  return (
    <ReactSuspense fallback={skeleton || (
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6"></div>
      </div>
    )}>
      {children}
    </ReactSuspense>
  );
}

const prefetchQueue = new Map<string, Promise<unknown>>();
const requestDedupeMap = new Map<string, Promise<unknown>>();

export function prefetchOnHover(
  promise: () => Promise<unknown>,
  key: string = Math.random().toString(36).substring(2)
) {
  const handleMouseEnter = async () => {
    if (prefetchQueue.has(key)) return;
    
    try {
      const resultPromise: Promise<unknown> = promise();
      prefetchQueue.set(key, resultPromise);
      await resultPromise;
      setTimeout(() => prefetchQueue.delete(key), 60000);
    } catch {
      prefetchQueue.delete(key);
    }
  };
  
  return { onMouseEnter: handleMouseEnter };
}

export async function dedupeRequest<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  if (requestDedupeMap.has(key)) {
    return requestDedupeMap.get(key) as Promise<T>;
  }
  
  const promise = fetcher();
  requestDedupeMap.set(key, promise);
  
  try {
    const result = await promise;
    return result;
  } finally {
    requestDedupeMap.delete(key);
  }
}