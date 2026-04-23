// public/sw.js - Service Worker for Offline-First Payments

const CACHE_NAME = "agenticpay-cache-v2";
const OFFLINE_QUEUE_DB = "agenticpay-offline-db";
const PAYMENT_QUEUE_STORE = "payment-queue";

const urlsToCache = [
  "/",
  "/icons/image-192.png",
  "/icons/image-512.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    )
  );
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" && event.request.method !== "POST") {
    return;
  }

  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.pathname.startsWith("/api/")) {
    event.respondWith(handleApiRequest(event.request));
    return;
  }

  if (event.request.destination === "document" || event.request.destination === "script" || 
      event.request.destination === "style" || event.request.destination === "image") {
    event.respondWith(
      caches.match(event.request).then((resp) => resp || fetch(event.request))
    );
  }
});

async function handleApiRequest(request) {
  if (!navigator.onLine) {
    return queueOfflineRequest(request);
  }

  try {
    return await fetch(request.clone());
  } catch {
    return queueOfflineRequest(request);
  }
}

async function queueOfflineRequest(request) {
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(PAYMENT_QUEUE_STORE, "readwrite");
    const store = tx.objectStore(PAYMENT_QUEUE_STORE);

    const body = await request.clone().text();
    const queuedRequest = {
      id: `queue-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
      timestamp: Date.now(),
      retryCount: 0,
    };

    await store.add(queuedRequest);
    await tx.done;

    return new Response(JSON.stringify({ queued: true, id: queuedRequest.id }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Failed to queue" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_QUEUE_DB, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(PAYMENT_QUEUE_STORE)) {
        db.createObjectStore(PAYMENT_QUEUE_STORE, { keyPath: "id" });
      }
    };
  });
}

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-payments") {
    event.waitUntil(syncQueuedPayments());
  }
});

async function syncQueuedPayments() {
  if (!navigator.onLine) return;

  try {
    const db = await openOfflineDB();
    const tx = db.transaction(PAYMENT_QUEUE_STORE, "readwrite");
    const store = tx.objectStore(PAYMENT_QUEUE_STORE);
    const requests = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    await Promise.allSettled(
      (requests as any[]).map(async (queued) => {
        const response = await fetch(queued.url, {
          method: queued.method,
          headers: queued.headers,
          body: queued.body,
        });

        if (response.ok) {
          const dt = db.transaction(PAYMENT_QUEUE_STORE, "readwrite");
          await dt.objectStore(PAYMENT_QUEUE_STORE).delete(queued.id);
        }
      })
    );
  } catch (error) {
    console.error("[SW] Sync failed:", error);
  }
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});