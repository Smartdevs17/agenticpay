'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  flushOfflineQueue,
  getQueuedActionCount,
  subscribeToOfflineQueue,
} from '@/lib/offline';
import { resolveApiUrl } from '@/lib/api/client';

interface OfflineContextValue {
  isOnline: boolean;
  queueLength: number;
  isSyncing: boolean;
}

const OfflineContext = createContext<OfflineContextValue>({
  isOnline: true,
  queueLength: 0,
  isSyncing: false,
});

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [queueLength, setQueueLength] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const syncQueueState = () => {
      setIsOnline(window.navigator.onLine);
      setQueueLength(getQueuedActionCount());
    };

    const flushQueuedActions = async () => {
      if (!window.navigator.onLine) {
        return;
      }

      const pendingActions = getQueuedActionCount();
      if (pendingActions === 0) {
        syncQueueState();
        return;
      }

      setIsSyncing(true);
      toast.info(`Back online. Syncing ${pendingActions} queued action${pendingActions === 1 ? '' : 's'}...`);

      const result = await flushOfflineQueue(resolveApiUrl);

      setIsSyncing(false);
      syncQueueState();

      if (result.processed > 0) {
        toast.success(`Synced ${result.processed} queued action${result.processed === 1 ? '' : 's'}.`);
      }

      if (result.remaining > 0) {
        toast.error(`${result.remaining} queued action${result.remaining === 1 ? '' : 's'} still need attention.`);
      }
    };

    syncQueueState();

    const handleOnline = () => {
      syncQueueState();
      void flushQueuedActions();
    };

    const handleOffline = () => {
      syncQueueState();
      toast.warning('You are offline. New API actions will be queued until the connection returns.');
    };

    const unsubscribe = subscribeToOfflineQueue(syncQueueState);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (window.navigator.onLine) {
      void flushQueuedActions();
    }

    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const value = useMemo(
    () => ({
      isOnline,
      queueLength,
      isSyncing,
    }),
    [isOnline, isSyncing, queueLength]
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOfflineStatus() {
  return useContext(OfflineContext);
}
