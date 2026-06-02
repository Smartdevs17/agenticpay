/// <reference lib="webworker" />

const CACHE_PREFIX = 'agenticpay';
const SW_VERSION = 'v2';
const PRECACHE_KEY = `${CACHE_PREFIX}-precache-${SW_VERSION}`;
const RUNTIME_CACHE_KEY = `${CACHE_PREFIX}-runtime-${SW_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/auth',
  '/dashboard',
  '/manifest.webmanifest',
  '/icons/image-192.png',
  '/icons/image-512.png',
];

declare const self: ServiceWorkerGlobalScope;

interface BackgroundSyncEvent extends ExtendableEvent {
  readonly tag: string;
}

interface BackgroundPeriodicSyncEvent extends ExtendableEvent {
  readonly tag: string;
}

interface SyncCapableServiceWorkerRegistration extends ServiceWorkerRegistration {
  sync?: {
    register(tag: string): Promise<void>;
  };
}

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

const OFFLINE_QUEUE_NAME = 'offline_payment_queue';

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('agenticpay_offline', 2);
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

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE_KEY);
      await cache.addAll(PRECACHE_URLS);
    })(),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys
          .filter(key => key !== PRECACHE_KEY && key !== RUNTIME_CACHE_KEY)
          .map(key => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE_KEY);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE_KEY);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request: Request): Promise<Response> {
  const cache = await caches.open(RUNTIME_CACHE_KEY);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  });

  return cached || fetchPromise;
}

async function networkOnly(request: Request): Promise<Response> {
  return fetch(request);
}

self.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  const pathname = url.pathname;

  if (request.method !== 'GET') {
    if (navigator.onLine) {
      event.respondWith(networkOnly(request));
    } else {
      event.respondWith(
        new Response(JSON.stringify({ error: 'offline', queued: true }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    return;
  }

  const requestDestination = request.destination;

  if (requestDestination === 'document' || request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (['script', 'style', 'image', 'font'].includes(requestDestination)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (pathname.startsWith('/api/')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

self.addEventListener('sync', ((event: Event) => {
  const syncEvent = event as BackgroundSyncEvent;
  if (syncEvent.tag === 'sync-payments') {
    syncEvent.waitUntil(syncPayments());
  }
}) as EventListener);

self.addEventListener('periodicsync', ((event: Event) => {
  const periodicEvent = event as BackgroundPeriodicSyncEvent;
  if (periodicEvent.tag === 'health-check') {
    periodicEvent.waitUntil(
      fetch('/api/v1/health').catch(() => {})
    );
  }
}) as EventListener);

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
        const registration = self.registration as SyncCapableServiceWorkerRegistration;
        if (registration.sync) {
          registration.sync.register('sync-payments');
        }
      }),
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

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─── Push Notification Handlers ─────────────────────────────────────────────

interface PushMessage {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: {
    deepLink?: string;
    category?: string;
    [key: string]: any;
  };
}

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) {
    console.warn('[SW] Push event without data');
    return;
  }

  try {
    const message: PushMessage = event.data.json();

    // Set default values
    const options: NotificationOptions = {
      body: message.body || 'You have a new notification',
      icon: message.icon || '/icons/notification.png',
      badge: message.badge || '/icons/badge.png',
      tag: message.tag || 'notification',
      requireInteraction:
        message.data?.category === 'dispute_alert' ||
        message.data?.category === 'security_alert',
      data: {
        ...message.data,
        timestamp: Date.now(),
      },
    };

    // Handle notification grouping
    if (message.tag) {
      options.tag = message.tag;
    }

    event.waitUntil(
      self.registration.showNotification(message.title || 'Notification', options)
    );
  } catch (error) {
    console.error('[SW] Error handling push event:', error);
    
    // Fallback: show generic notification
    event.waitUntil(
      self.registration.showNotification('New Notification', {
        body: 'You have a new message',
        icon: '/icons/notification.png',
        badge: '/icons/badge.png',
      })
    );
  }
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  const notification = event.notification;
  const deepLink = notification.data?.deepLink;

  // Mark notification as clicked via API
  if (notification.data?.notificationId) {
    markNotificationAsClicked(notification.data.notificationId).catch(err =>
      console.error('[SW] Error marking notification as clicked:', err)
    );
  }

  event.notification.close();

  // Handle deep link navigation
  const targetUrl = deepLink || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Check if already a window open
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }

      // Open new window with deep link
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener('notificationclose', (event: NotificationEvent) => {
  const notification = event.notification;

  // Log notification dismissal (optional)
  console.log('[SW] Notification closed:', notification.data?.tag);

  // You can send analytics here
  if (notification.data?.notificationId) {
    // Could send a dismissal event to analytics service
  }
});

/**
 * Helper function to mark notification as clicked in the backend
 */
async function markNotificationAsClicked(notificationId: string): Promise<void> {
  try {
    const response = await fetch(`/api/v1/push/mark-clicked/${notificationId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn('[SW] Failed to mark notification as clicked:', response.statusText);
    }
  } catch (error) {
    console.error('[SW] Error marking notification as clicked:', error);
    // Silently fail - this is not critical
  }
}

export default null;
