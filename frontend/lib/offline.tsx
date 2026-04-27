const OFFLINE_QUEUE_STORAGE_KEY = 'agenticpay-offline-queue';
const OFFLINE_QUEUE_EVENT = 'agenticpay:offline-queue-updated';

import { useState, useEffect } from 'react';

export interface QueuedAction {
  id: string;
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  createdAt: string;
}

export interface OfflinePayment {
  id: string;
  to: string;
  amount: string;
  asset: string;
  memo?: string;
  createdAt: number;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  retryCount: number;
  error?: string;
}

export interface SyncStatus {
  isOnline: boolean;
  lastSyncAt?: number;
  pendingCount: number;
  failedCount: number;
}

export class OfflineActionQueuedError extends Error {
  endpoint: string;
  actionId: string;

  constructor(message: string, endpoint: string, actionId: string) {
    super(message);
    this.name = 'OfflineActionQueuedError';
    this.endpoint = endpoint;
    this.actionId = actionId;
  }
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function emitQueueUpdate() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(OFFLINE_QUEUE_EVENT));
}

function readQueue(): QueuedAction[] {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as QueuedAction[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedAction[]) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  emitQueueUpdate();
}

export function getQueuedActions() {
  return readQueue();
}

export function getQueuedActionCount() {
  return readQueue().length;
}

export function subscribeToOfflineQueue(listener: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(OFFLINE_QUEUE_EVENT, listener);
  window.addEventListener('storage', listener);

  return () => {
    window.removeEventListener(OFFLINE_QUEUE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

export function shouldQueueRequest(options: RequestInit = {}) {
  const method = (options.method || 'GET').toUpperCase();
  return !['GET', 'HEAD'].includes(method);
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, String(value)])
  );
}

export function queueOfflineAction(endpoint: string, options: RequestInit = {}) {
  const action: QueuedAction = {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    endpoint,
    method: (options.method || 'POST').toUpperCase(),
    headers: normalizeHeaders(options.headers),
    body: typeof options.body === 'string' ? options.body : undefined,
    createdAt: new Date().toISOString(),
  };

  writeQueue([...readQueue(), action]);
  return action;
}

export function removeQueuedAction(actionId: string) {
  writeQueue(readQueue().filter((action) => action.id !== actionId));
}

export function isLikelyOfflineError(error: unknown) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === 'TypeError' ||
    /failed to fetch/i.test(error.message) ||
    /networkerror/i.test(error.message)
  );
}

export async function flushOfflineQueue(resolveApiUrl: (endpoint: string) => string) {
  const queue = readQueue();
  let processed = 0;
  let failed = 0;

  for (const action of queue) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      break;
    }

    try {
      const response = await fetch(resolveApiUrl(action.endpoint), {
        method: action.method,
        headers: {
          ...action.headers,
          'X-AgenticPay-Offline-Replay': 'true',
        },
        body: action.body,
      });

      if (!response.ok) {
        failed += 1;
        continue;
      }

      removeQueuedAction(action.id);
      processed += 1;
    } catch {
      failed += 1;
      break;
    }
  }

  return {
    processed,
    failed,
    remaining: getQueuedActionCount(),
  };
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js');
    console.log('Service Worker registered:', registration.scope);
    return registration;
  } catch (error) {
    console.error('Service Worker registration failed:', error);
    return null;
  }
}

export async function requestBackgroundSync(tag: string): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    if ('sync' in registration) {
      await (registration as any).sync.register(tag);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function useOfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export function OfflinePaymentIndicator() {
  const isOnline = useOfflineIndicator();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const queue = readQueue();
    setPendingCount(queue.length);

    const listener = () => {
      setPendingCount(readQueue().length);
    };

    window.addEventListener(OFFLINE_QUEUE_EVENT, listener);
    window.addEventListener('storage', listener);

    return () => {
      window.removeEventListener(OFFLINE_QUEUE_EVENT, listener);
      window.removeEventListener('storage', listener);
    };
  }, []);

  if (isOnline && pendingCount === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 bg-amber-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-50">
      <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
      <span className="text-sm font-medium">
        {!isOnline
          ? 'Offline - payments queued'
          : `${pendingCount} payment${pendingCount > 1 ? 's' : ''} pending sync`}
      </span>
    </div>
  );
}
