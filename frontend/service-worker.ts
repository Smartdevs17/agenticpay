const SHELL_CACHE = 'agenticpay_shell_v1';
const RUNTIME_CACHE = 'agenticpay_runtime_v1';
const OFFLINE_QUEUE_NAME = 'offline_payment_queue';

const APP_SHELL_URLS = [
  '/',
  '/auth',
  '/dashboard',
  '/manifest.webmanifest',
  '/icons/image-192.png',
  '/icons/image-512.png',
];

declare const self: ServiceWorkerGlobalScope;

interface PaymentRequest {
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

interface SyncStatus {
  isOnline: boolean;
  lastSyncAt?: number;
  pendingCount: number;
  failedCount: number;
}

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('agenticpay_offline', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_NAME)) {
        db.createObjectStore(OFFLINE_QUEUE_NAME, { keyPath: 'id' });
      }
    };
  });
}

async function getPaymentQueue(): Promise<PaymentRequest[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_NAME, 'readonly');
    const store = tx.objectStore(OFFLINE_QUEUE_NAME);
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function addToPaymentQueue(payment: PaymentRequest): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_NAME, 'readwrite');
    const store = tx.objectStore(OFFLINE_QUEUE_NAME);
    const request = store.add(payment);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

async function updatePayment(payment: PaymentRequest): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_NAME, 'readwrite');
    const store = tx.objectStore(OFFLINE_QUEUE_NAME);
    const request = store.put(payment);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

async function removeFromQueue(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_NAME, 'readwrite');
    const store = tx.objectStore(OFFLINE_QUEUE_NAME);
    const request = store.delete(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

async function syncPayments(): Promise<{ success: number; failed: number }> {
  const queue = await getPaymentQueue();
  const pending = queue.filter(p => p.status === 'pending' || p.status === 'failed');
  
  let success = 0;
  let failed = 0;

  for (const payment of pending) {
    try {
      payment.status = 'syncing';
      await updatePayment(payment);

      const response = await fetch('/api/v1/stellar/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: payment.to,
          amount: payment.amount,
          asset: payment.asset,
          memo: payment.memo,
        }),
      });

      if (response.ok) {
        payment.status = 'synced';
        await removeFromQueue(payment.id);
        success++;
      } else {
        payment.status = 'failed';
        payment.retryCount++;
        payment.error = 'Sync failed';
        await updatePayment(payment);
        failed++;
      }
    } catch (error) {
      payment.status = 'failed';
      payment.retryCount++;
      payment.error = error instanceof Error ? error.message : 'Unknown error';
      await updatePayment(payment);
      failed++;
    }
  }

  return { success, failed };
}

function cacheFirst(request: Request): Promise<Response> {
  return caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (response.ok) {
        caches.open(RUNTIME_CACHE).then(cache => cache.put(request, response.clone()));
      }
      return response;
    });
  });
}

function networkFirst(request: Request): Promise<Response> {
  return fetch(request)
    .then(response => {
      if (response.ok) {
        caches.open(RUNTIME_CACHE).then(cache => cache.put(request, response.clone()));
      }
      return response;
    })
    .catch(() => caches.match(request).then(cached => cached || new Response('Offline', { status: 503 })));
}

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(APP_SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (request.method !== 'GET') {
    if (navigator.onLine) {
      event.respondWith(networkFirst(request));
    } else {
      event.respondWith(
        new Response(JSON.stringify({ error: 'offline', queued: true }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    ['script', 'style', 'image', 'font'].includes(request.destination) ||
    APP_SHELL_URLS.includes(url.pathname)
  ) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener('sync', (event: SyncEvent) => {
  if (event.tag === 'sync-payments') {
    event.waitUntil(syncPayments());
  }
});

self.addEventListener('periodicsync', (event: PeriodicSyncEvent) => {
  if (event.tag === 'health-check') {
    event.waitUntil(
      fetch('/api/v1/health').catch(() => {})
    );
  }
});

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const { type, payload } = event.data || {};

  if (type === 'ADD_OFFLINE_PAYMENT') {
    event.waitUntil(
      addToPaymentQueue({
        id: `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...payload,
        createdAt: Date.now(),
        status: 'pending',
        retryCount: 0,
      }).then(() => {
        if (self.registration.sync) {
          self.registration.sync.register('sync-payments');
        }
      })
    );
  }

  if (type === 'GET_SYNC_STATUS') {
    event.ports[0]?.postMessage({
      isOnline: navigator.onLine,
      pendingCount: 0,
      failedCount: 0,
    });
  }

  if (type === 'SYNC_NOW') {
    event.waitUntil(syncPayments());
  }
});

export default null;