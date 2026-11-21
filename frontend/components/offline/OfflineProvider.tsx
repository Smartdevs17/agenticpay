'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { useOfflineStore } from '@/store/useOfflineStore';
import {
  flushOfflineQueue,
  getQueuedActionCount,
  subscribeToOfflineQueue,
} from '@/lib/offline';
import { resolveApiUrl } from '@/lib/api/client';

/**
 * OfflineProvider
 *
 * Sets up online/offline event listeners and syncs the shared
 * `useOfflineStore` Zustand store. No React Context is used — state is
 * available to any component via the store's selectors.
 *
 * Mount this once near the root of the app (wrapping children is optional;
 * the component renders its children unchanged).
 */
export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const setOnline = useOfflineStore((s) => s.setOnline);
  const setQueueLength = useOfflineStore((s) => s.setQueueLength);
  const setSyncing = useOfflineStore((s) => s.setSyncing);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let serviceWorkerQueueLength = 0;

    const syncQueueState = () => {
      setOnline(window.navigator.onLine);
      setQueueLength(getQueuedActionCount() + serviceWorkerQueueLength);
    };

    const flushQueuedActions = async () => {
      if (!window.navigator.onLine) return;

      const pending = getQueuedActionCount();
      if (pending === 0) {
        syncQueueState();
        return;
      }

      setSyncing(true);
      toast.info(`Back online. Syncing ${pending} queued action${pending === 1 ? '' : 's'}...`);

      const result = await flushOfflineQueue(resolveApiUrl);

      setSyncing(false);
      syncQueueState();

      if (result.processed > 0) {
        toast.success(`Synced ${result.processed} queued action${result.processed === 1 ? '' : 's'}.`);
      }
      if (result.remaining > 0) {
        toast.error(`${result.remaining} queued action${result.remaining === 1 ? '' : 's'} still need attention.`);
      }
    };

    const handleOnline = () => {
      syncQueueState();
      void flushQueuedActions();
    };

    const handleOffline = () => {
      syncQueueState();
      toast.warning('You are offline. New API actions will be queued until the connection returns.');
    };

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PAYMENT_QUEUE_CHANGED') {
        serviceWorkerQueueLength = Number(event.data.remaining) || 0;
        syncQueueState();
      }

      if (event.data?.type === 'PAYMENT_QUEUE_SYNCED') {
        serviceWorkerQueueLength = Number(event.data.remaining) || 0;
        syncQueueState();

        if (event.data.synced > 0) {
          toast.success(`Synced ${event.data.synced} offline payment${event.data.synced === 1 ? '' : 's'}.`);
        }
      }
    };

    syncQueueState();

    const unsubscribe = subscribeToOfflineQueue(syncQueueState);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);

    if (window.navigator.onLine) {
      void flushQueuedActions();
    }

    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [setOnline, setQueueLength, setSyncing]);

  return <>{children}</>;
}

/**
 * useOfflineStatus
 *
 * Drop-in replacement for the previous Context-based hook.
 * Subscribes to the Zustand offline store with minimal re-renders.
 */
export function useOfflineStatus() {
  const isOnline = useOfflineStore((s) => s.isOnline);
  const queueLength = useOfflineStore((s) => s.queueLength);
  const isSyncing = useOfflineStore((s) => s.isSyncing);
  return { isOnline, queueLength, isSyncing };
}
