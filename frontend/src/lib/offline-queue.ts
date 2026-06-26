// IndexedDB-backed offline transaction queue.
// Queued items are submitted when connectivity returns via the SyncManager API
// or the useOnlineStatus hook's manual flush trigger.

const DB_NAME = 'agenticpay-offline-db';
const DB_VERSION = 2; // v1 used by sw.js; v2 adds retry_at index
const TX_STORE = 'offline-payments';
const SYNC_TAG = 'agenticpay-payment-sync';

export type QueuedItemStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface QueuedTransaction {
  id: string;
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  createdAt: number;
  updatedAt: number;
  status: QueuedItemStatus;
  retryCount: number;
  retryAt?: number;
  lastError?: string;
}

export interface QueueSnapshot {
  pending: number;
  syncing: number;
  failed: number;
  total: number;
  items: QueuedTransaction[];
}

export interface FlushResult {
  synced: number;
  failed: number;
  remaining: number;
}

const MAX_RETRIES = 5;
const RETRY_BACKOFF_MS = [5_000, 15_000, 60_000, 300_000, 600_000];

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(TX_STORE)) {
        const store = db.createObjectStore(TX_STORE, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('retryAt', 'retryAt', { unique: false });
      } else if (e.oldVersion < 2) {
        const store = req.transaction!.objectStore(TX_STORE);
        if (!store.indexNames.contains('retryAt')) {
          store.createIndex('retryAt', 'retryAt', { unique: false });
        }
      }
    };
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TX_STORE, mode);
    const store = tx.objectStore(TX_STORE);
    const req = op(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }).finally(() => db.close()) as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function enqueue(
  input: Pick<QueuedTransaction, 'endpoint' | 'method' | 'headers' | 'body'>,
): Promise<QueuedTransaction> {
  const item: QueuedTransaction = {
    id: crypto.randomUUID(),
    ...input,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    retryCount: 0,
  };
  await withStore('readwrite', (s) => s.put(item));
  await triggerBackgroundSync();
  dispatchQueueEvent();
  return item;
}

export async function getSnapshot(): Promise<QueueSnapshot> {
  const items = await withStore<QueuedTransaction[]>('readonly', (s) => s.getAll());
  return {
    pending: items.filter((i) => i.status === 'pending').length,
    syncing: items.filter((i) => i.status === 'syncing').length,
    failed: items.filter((i) => i.status === 'failed').length,
    total: items.length,
    items,
  };
}

export async function flush(apiBaseUrl = ''): Promise<FlushResult> {
  const items = await withStore<QueuedTransaction[]>('readonly', (s) => s.getAll());
  const due = items.filter(
    (i) => i.status !== 'synced' && i.status !== 'syncing' && (i.retryAt === undefined || i.retryAt <= Date.now()),
  );

  let synced = 0;
  let failed = 0;

  for (const item of due) {
    await put({ ...item, status: 'syncing', updatedAt: Date.now() });

    try {
      const res = await fetch(`${apiBaseUrl}${item.endpoint}`, {
        method: item.method,
        headers: { ...item.headers, 'X-AgenticPay-Offline-Replay': 'true' },
        body: item.body,
      });

      if (res.ok || res.status === 409) {
        await remove(item.id);
        synced += 1;
      } else {
        await markFailed(item, `HTTP ${res.status}`);
        failed += 1;
      }
    } catch (err) {
      await markFailed(item, err instanceof Error ? err.message : String(err));
      failed += 1;
      if (!navigator.onLine) break; // stop retrying if we've gone offline
    }
  }

  dispatchQueueEvent();
  return { synced, failed, remaining: (await getSnapshot()).total };
}

export async function removeItem(id: string): Promise<void> {
  await remove(id);
  dispatchQueueEvent();
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TX_STORE, 'readwrite');
    const req = tx.objectStore(TX_STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
  dispatchQueueEvent();
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function put(item: QueuedTransaction): Promise<void> {
  await withStore('readwrite', (s) => s.put({ ...item, updatedAt: Date.now() }));
}

async function remove(id: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(id));
}

async function markFailed(item: QueuedTransaction, error: string): Promise<void> {
  const retryCount = (item.retryCount ?? 0) + 1;
  const backoffMs = RETRY_BACKOFF_MS[Math.min(retryCount - 1, RETRY_BACKOFF_MS.length - 1)];
  await put({
    ...item,
    status: retryCount >= MAX_RETRIES ? 'failed' : 'pending',
    retryCount,
    retryAt: Date.now() + backoffMs,
    lastError: error,
  });
}

async function triggerBackgroundSync(): Promise<void> {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if ('sync' in reg) {
        await (reg as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync.register(
          SYNC_TAG,
        );
      }
    } catch {
      // SyncManager not supported or SW not active — flush will run manually
    }
  }
}

const QUEUE_EVENT = 'agenticpay:offline-queue-changed';

function dispatchQueueEvent(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(QUEUE_EVENT));
  }
}

export function subscribeToQueue(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(QUEUE_EVENT, listener);
  return () => window.removeEventListener(QUEUE_EVENT, listener);
}
