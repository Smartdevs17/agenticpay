const OFFLINE_QUEUE_STORAGE_KEY = 'agenticpay-offline-queue';
const OFFLINE_QUEUE_EVENT = 'agenticpay:offline-queue-updated';

export interface QueuedAction {
  id: string;
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  createdAt: string;
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
