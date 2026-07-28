'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { flush, getSnapshot, subscribeToQueue, type FlushResult, type QueueSnapshot } from '@/src/lib/offline-queue';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export interface OnlineStatus {
  isOnline: boolean;
  wasOffline: boolean;
  queue: QueueSnapshot;
  isFlushing: boolean;
  lastFlushResult: FlushResult | null;
  flushNow: () => Promise<void>;
}

export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [wasOffline, setWasOffline] = useState(false);
  const [queue, setQueue] = useState<QueueSnapshot>({
    pending: 0,
    syncing: 0,
    failed: 0,
    total: 0,
    items: [],
  });
  const [isFlushing, setIsFlushing] = useState(false);
  const [lastFlushResult, setLastFlushResult] = useState<FlushResult | null>(null);
  const flushingRef = useRef(false);

  const refreshQueue = useCallback(async () => {
    try {
      const snap = await getSnapshot();
      setQueue(snap);
    } catch {
      // IndexedDB unavailable (SSR / private mode)
    }
  }, []);

  const flushNow = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    setIsFlushing(true);
    try {
      const result = await flush(BASE_URL);
      setLastFlushResult(result);
      await refreshQueue();
    } finally {
      flushingRef.current = false;
      setIsFlushing(false);
    }
  }, [refreshQueue]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    refreshQueue();

    const handleOnline = () => {
      setIsOnline(true);
      setWasOffline(true);
      flushNow();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    // Handle messages from the service worker about queue state changes.
    const handleSwMessage = (e: MessageEvent) => {
      const { type } = e.data ?? {};
      if (type === 'PAYMENT_QUEUE_CHANGED' || type === 'PAYMENT_QUEUE_SYNCED') {
        refreshQueue();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const unsubscribeQueue = subscribeToQueue(refreshQueue);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribeQueue();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
    };
  }, [flushNow, refreshQueue]);

  // Flush any pending items on mount when already online.
  useEffect(() => {
    if (isOnline) {
      refreshQueue().then((async () => {
        const snap = await getSnapshot();
        if (snap.pending > 0) flushNow();
      }) as () => Promise<void>);
    }
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isOnline, wasOffline, queue, isFlushing, lastFlushResult, flushNow };
}
