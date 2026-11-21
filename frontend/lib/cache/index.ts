const DB_NAME = 'agenticpay_cache';
const DB_VERSION = 1;
const CACHE_STORE = 'response_cache';
const META_STORE = 'cache_meta';

interface CacheMeta {
  key: string;
  expiresAt: number;
  createdAt: number;
  size: number;
  etag?: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        const metaStore = db.createObjectStore(META_STORE, { keyPath: 'key' });
        metaStore.createIndex('expiresAt', 'expiresAt', { unique: false });
      }
    };
  });
}

async function getFromDB<T>(key: string): Promise<{ value: T; meta: CacheMeta } | null> {
  const db = await openDB();
  const tx = db.transaction([CACHE_STORE, META_STORE], 'readonly');
  const cacheStore = tx.objectStore(CACHE_STORE);
  const metaStore = tx.objectStore(META_STORE);

  const [valueResult, metaResult] = await Promise.all([
    new Promise<unknown>((resolve, reject) => {
      const r = cacheStore.get(key);
      r.onerror = () => reject(r.error);
      r.onsuccess = () => resolve(r.result);
    }),
    new Promise<unknown>((resolve, reject) => {
      const r = metaStore.get(key);
      r.onerror = () => reject(r.error);
      r.onsuccess = () => resolve(r.result);
    }),
  ]);

  if (!valueResult || !metaResult) return null;
  return { value: valueResult as T, meta: metaResult as CacheMeta };
}

async function setInDB<T>(key: string, value: T, ttlMs: number, etag?: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([CACHE_STORE, META_STORE], 'readwrite');
  const cacheStore = tx.objectStore(CACHE_STORE);
  const metaStore = tx.objectStore(META_STORE);

  const bodyStr = JSON.stringify(value);
  const meta: CacheMeta = {
    key,
    expiresAt: Date.now() + ttlMs,
    createdAt: Date.now(),
    size: bodyStr.length,
    etag,
  };

  cacheStore.put(value, key);
  metaStore.put(meta);
}

async function deleteFromDB(key: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([CACHE_STORE, META_STORE], 'readwrite');
  tx.objectStore(CACHE_STORE).delete(key);
  tx.objectStore(META_STORE).delete(key);
}

async function evictExpired(): Promise<number> {
  const db = await openDB();
  const tx = db.transaction(META_STORE, 'readonly');
  const index = tx.objectStore(META_STORE).index('expiresAt');
  const range = IDBKeyRange.upperBound(Date.now());
  const expiredKeys: string[] = [];

  return new Promise((resolve, reject) => {
    const cursor = index.openCursor(range);
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      if (cursor.result) {
        expiredKeys.push(cursor.result.value.key);
        cursor.result.continue();
      } else {
        Promise.all(expiredKeys.map(k => deleteFromDB(k)))
          .then(() => resolve(expiredKeys.length))
          .catch(reject);
      }
    };
  });
}

export type CacheStrategy = 'cache-first' | 'network-first' | 'stale-while-revalidate' | 'network-only';

export interface CacheConfig {
  strategy: CacheStrategy;
  ttl: number;
  etag?: boolean;
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  strategy: 'stale-while-revalidate',
  ttl: 5 * 60 * 1000,
  etag: true,
};

export async function cacheFetch<T>(
  url: string,
  options: RequestInit = {},
  config: Partial<CacheConfig> = {},
): Promise<T> {
  const cfg = { ...DEFAULT_CACHE_CONFIG, ...config };
  const cacheKey = `fetch:${options.method || 'GET'}:${url}`;

  switch (cfg.strategy) {
    case 'network-only':
      return networkOnlyFetch<T>(url, options);

    case 'cache-first':
      return cacheFirstFetch<T>(url, options, cacheKey, cfg);

    case 'network-first':
      return networkFirstFetch<T>(url, options, cacheKey, cfg);

    case 'stale-while-revalidate':
    default:
      return staleWhileRevalidateFetch<T>(url, options, cacheKey, cfg);
  }
}

async function networkOnlyFetch<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return response.json();
}

async function cacheFirstFetch<T>(
  url: string,
  options: RequestInit,
  cacheKey: string,
  cfg: CacheConfig,
): Promise<T> {
  const cached = await getFromDB<T>(cacheKey);
  if (cached && cached.meta.expiresAt > Date.now()) {
    return cached.value;
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    if (cached) return cached.value;
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const etag = response.headers.get('ETag') || undefined;
  await setInDB(cacheKey, data, cfg.ttl, etag);
  return data;
}

async function networkFirstFetch<T>(
  url: string,
  options: RequestInit,
  cacheKey: string,
  cfg: CacheConfig,
): Promise<T> {
  try {
    const response = await fetch(url, options);
    if (response.ok) {
      const data = await response.json();
      const etag = response.headers.get('ETag') || undefined;
      await setInDB(cacheKey, data, cfg.ttl, etag);
      return data;
    }
    throw new Error(`HTTP ${response.status}`);
  } catch {
    const cached = await getFromDB<T>(cacheKey);
    if (cached) return cached.value;
    throw new Error('Network request failed and no cache available');
  }
}

async function staleWhileRevalidateFetch<T>(
  url: string,
  options: RequestInit,
  cacheKey: string,
  cfg: CacheConfig,
): Promise<T> {
  const cached = await getFromDB<T>(cacheKey);
  const isFresh = cached && cached.meta.expiresAt > Date.now();

  if (cached) {
    if (isFresh) return cached.value;

    const revalidatePromise = (async () => {
      try {
        const headers: Record<string, string> = {};
        if (cfg.etag && cached.meta.etag) headers['If-None-Match'] = cached.meta.etag;

        const response = await fetch(url, { ...options, headers });
        if (response.status === 304) {
          await setInDB(cacheKey, cached.value, cfg.ttl, cached.meta.etag);
          return;
        }
        if (response.ok) {
          const data = await response.json();
          const etag = response.headers.get('ETag') || undefined;
          await setInDB(cacheKey, data, cfg.ttl, etag);
        }
      } catch {}
    })();

    return cached.value;
  }

  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

  const data = await response.json();
  const etag = response.headers.get('ETag') || undefined;
  await setInDB(cacheKey, data, cfg.ttl, etag);
  return data;
}

export async function invalidateCache(pattern?: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(META_STORE, 'readonly');
  const allKeys: string[] = [];

  return new Promise((resolve, reject) => {
    const cursor = tx.objectStore(META_STORE).openCursor();
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      if (cursor.result) {
        const key = cursor.result.value.key;
        if (!pattern || key.includes(pattern)) {
          allKeys.push(key);
        }
        cursor.result.continue();
      } else {
        Promise.all(allKeys.map(k => deleteFromDB(k)))
          .then(() => resolve())
          .catch(reject);
      }
    };
  });
}

export async function getCacheSize(): Promise<{ entries: number; totalSize: number }> {
  const db = await openDB();
  const tx = db.transaction(META_STORE, 'readonly');
  const all: CacheMeta[] = [];

  return new Promise((resolve, reject) => {
    const cursor = tx.objectStore(META_STORE).openCursor();
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      if (cursor.result) {
        all.push(cursor.result.value);
        cursor.result.continue();
      } else {
        resolve({
          entries: all.length,
          totalSize: all.reduce((sum, m) => sum + m.size, 0),
        });
      }
    };
  });
}

if (typeof window !== 'undefined' && 'indexedDB' in window) {
  setInterval(() => { evictExpired().catch(() => {}); }, 60_000);
}
