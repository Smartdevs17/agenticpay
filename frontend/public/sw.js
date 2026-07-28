// AgenticPay service worker: offline shell, API fallback cache, and payment replay queue.
// Updated for PWA (#501): IndexedDB v2 with retryAt index, conflict resolution,
// storage-limit eviction, and periodic background-sync fallback.

const APP_VERSION = '2026-06-27.1';
const CACHE_PREFIX = 'agenticpay';
const PRECACHE = `${CACHE_PREFIX}-precache-${APP_VERSION}`;
const RUNTIME = `${CACHE_PREFIX}-runtime-${APP_VERSION}`;
const API_CACHE = `${CACHE_PREFIX}-api-${APP_VERSION}`;
const DB_NAME = 'agenticpay-offline-db';
const DB_VERSION = 2; // v2 adds retryAt index and exponential backoff
const PAYMENT_STORE = 'offline-payments';

const MAX_RETRIES = 5;
const RETRY_BACKOFF_MS = [5_000, 15_000, 60_000, 300_000, 600_000];
const SYNC_TAG = 'agenticpay-payment-sync';
const PRECACHE_URLS = [
  '/',
  '/auth',
  '/dashboard',
  '/dashboard/payments',
  '/dashboard/transactions',
  '/manifest.webmanifest',
  '/icons/image-192.png',
  '/icons/image-512.png',
];
const STATIC_DESTINATIONS = new Set(['script', 'style', 'image', 'font', 'manifest']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then(async (cache) => {
      await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })));
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && ![PRECACHE, RUNTIME, API_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
      await broadcast({ type: 'SW_ACTIVATED', version: APP_VERSION });
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.method !== 'GET') {
    if (isPaymentMutation(url.pathname)) {
      event.respondWith(queuePaymentMutation(request));
      return;
    }

    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstDocument(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  if (STATIC_DESTINATIONS.has(request.destination) || url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG || event.tag === 'sync-payments') {
    event.waitUntil(flushPaymentQueue());
  }
});

self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (type === 'QUEUE_PAYMENT') {
    event.waitUntil(
      savePayment({
        id: payload?.id || crypto.randomUUID(),
        endpoint: payload?.endpoint || '/api/v1/stellar/pay',
        method: payload?.method || 'POST',
        headers: payload?.headers || { 'content-type': 'application/json' },
        body: payload?.body || JSON.stringify(payload?.payment || {}),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'pending',
        retryCount: 0,
      }).then(registerSync).then(notifyQueueChanged),
    );
    return;
  }

  if (type === 'SYNC_NOW') {
    event.waitUntil(flushPaymentQueue());
    return;
  }

  if (type === 'GET_QUEUE_STATUS') {
    event.waitUntil(
      getQueuedPayments().then((items) => {
        event.ports?.[0]?.postMessage({
          pendingCount: items.filter((item) => item.status !== 'synced').length,
          failedCount: items.filter((item) => item.status === 'failed').length,
          version: APP_VERSION,
        });
      }),
    );
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await safeCachePut(RUNTIME, request, response.clone());
  }
  return response;
}

async function networkFirstDocument(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await safeCachePut(RUNTIME, request, response.clone());
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match('/dashboard')) || (await caches.match('/')) || offlineResponse('Offline dashboard shell unavailable');
  }
}

async function networkFirstApi(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await safeCachePut(API_CACHE, request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-AgenticPay-Cache', 'stale');
      return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
    }
    return new Response(JSON.stringify({ error: 'offline', message: 'Network unavailable and no cached API response exists.' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'X-AgenticPay-Offline': 'true' },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) void safeCachePut(RUNTIME, request, response.clone());
      return response;
    })
    .catch(() => undefined);

  return cached || (await network) || offlineResponse('Offline');
}

async function safeCachePut(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch (error) {
    // Storage quota can be exceeded on mobile; evict runtime entries and continue serving network data.
    if (error && (error.name === 'QuotaExceededError' || /quota/i.test(String(error.message)))) {
      await caches.delete(RUNTIME);
      await caches.delete(API_CACHE);
    }
  }
}

function offlineResponse(message) {
  return new Response(message, { status: 503, headers: { 'content-type': 'text/plain', 'X-AgenticPay-Offline': 'true' } });
}

function isPaymentMutation(pathname) {
  return pathname.includes('/pay') || pathname.includes('/payments') || pathname.includes('/stellar/pay');
}

async function queuePaymentMutation(request) {
  try {
    const clone = request.clone();
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (online) {
      return await fetch(request);
    }

    const payment = await requestToQueuedPayment(clone);
    await savePayment(payment);
    await registerSync();
    await notifyQueueChanged();
    return new Response(JSON.stringify({ queued: true, id: payment.id, offline: true }), {
      status: 202,
      headers: { 'content-type': 'application/json', 'X-AgenticPay-Offline-Queued': 'true' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'offline_queue_failed', message: String(error?.message || error) }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
}

async function requestToQueuedPayment(request) {
  return {
    id: crypto.randomUUID(),
    endpoint: new URL(request.url).pathname + new URL(request.url).search,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: await request.text(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    retryCount: 0,
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PAYMENT_STORE)) {
        const store = db.createObjectStore(PAYMENT_STORE, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('retryAt', 'retryAt', { unique: false });
      } else if (event.oldVersion < 2) {
        const store = request.transaction.objectStore(PAYMENT_STORE);
        if (!store.indexNames.contains('retryAt')) {
          store.createIndex('retryAt', 'retryAt', { unique: false });
        }
      }
    };
  });
}

async function withStore(storeMode, operation) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PAYMENT_STORE, storeMode);
    const store = transaction.objectStore(PAYMENT_STORE);
    const request = operation(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }).finally(() => db.close());
}

async function savePayment(payment) {
  await withStore('readwrite', (store) => store.put({ ...payment, updatedAt: Date.now() }));
}

async function deletePayment(id) {
  await withStore('readwrite', (store) => store.delete(id));
}

async function getQueuedPayments() {
  return (await withStore('readonly', (store) => store.getAll())) || [];
}

async function flushPaymentQueue() {
  const queued = await getQueuedPayments();
  const now = Date.now();
  const due = queued.filter(
    (i) => i.status !== 'synced' && i.status !== 'syncing' &&
            (i.retryAt === undefined || i.retryAt <= now),
  );
  let synced = 0;
  let failed = 0;

  for (const item of due) {
    await savePayment({ ...item, status: 'syncing' });
    try {
      const response = await fetch(item.endpoint, {
        method: item.method,
        headers: { ...item.headers, 'X-AgenticPay-Offline-Replay': 'true' },
        body: item.body,
      });

      if (response.ok || response.status === 409) {
        // 409 Conflict: server already processed this request (idempotent)
        await deletePayment(item.id);
        synced += 1;
      } else {
        const retryCount = (item.retryCount || 0) + 1;
        const backoffMs = RETRY_BACKOFF_MS[Math.min(retryCount - 1, RETRY_BACKOFF_MS.length - 1)];
        await savePayment({
          ...item,
          status: retryCount >= MAX_RETRIES ? 'failed' : 'pending',
          retryCount,
          retryAt: Date.now() + backoffMs,
          lastError: `HTTP ${response.status}`,
        });
        failed += 1;
      }
    } catch (error) {
      const retryCount = (item.retryCount || 0) + 1;
      const backoffMs = RETRY_BACKOFF_MS[Math.min(retryCount - 1, RETRY_BACKOFF_MS.length - 1)];
      await savePayment({
        ...item,
        status: retryCount >= MAX_RETRIES ? 'failed' : 'pending',
        retryCount,
        retryAt: Date.now() + backoffMs,
        lastError: String(error?.message || error),
      });
      failed += 1;
      if (!self.navigator || !self.navigator.onLine) break;
    }
  }

  const remaining = (await getQueuedPayments()).length;
  await broadcast({ type: 'PAYMENT_QUEUE_SYNCED', synced, failed, remaining });
  return { synced, failed };
}

async function registerSync() {
  if ('sync' in self.registration) {
    await self.registration.sync.register(SYNC_TAG);
  }
}

async function notifyQueueChanged() {
  const remaining = (await getQueuedPayments()).length;
  await broadcast({ type: 'PAYMENT_QUEUE_CHANGED', remaining });
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) {
    client.postMessage(message);
  }
}
