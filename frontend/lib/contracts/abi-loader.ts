import { Abi } from 'viem';

export type ChainType = 'evm' | 'soroban';
export type EvmChain = 'mainnet' | 'sepolia' | 'polygon' | 'polygonAmoy' | 'arbitrum' | 'arbitrumSepolia' | 'optimism' | 'optimismSepolia' | 'base' | 'baseSepolia';

const DB_NAME = 'agenticpay-abi-cache';
const DB_VERSION = 1;
const STORE_NAME = 'abis';
const CACHE_TTL = 24 * 60 * 60 * 1000;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCached(key: string): Promise<Abi | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const entry = req.result;
        if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
          resolve(entry.abi as Abi);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function setCache(key: string, abi: Abi): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ key, abi, timestamp: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // fail silently - cache is optional
  }
}

const moduleCache = new Map<string, Promise<Abi>>();

async function importAbi(chain: EvmChain, contract: string): Promise<Abi> {
  switch (chain) {
    case 'mainnet':
      return import(`@/lib/abi/evm/${contract}.json`).then((m) => (m.abi || m.default?.abi || m.default) as Abi);
    case 'sepolia':
      return import(`@/lib/abi/evm/${contract}.json`).then((m) => (m.abi || m.default?.abi || m.default) as Abi);
    default:
      return import(`@/lib/abi/evm/${contract}.json`).then((m) => (m.abi || m.default?.abi || m.default) as Abi);
  }
}

export async function loadAbi(chain: EvmChain, contract: string): Promise<Abi> {
  const cacheKey = `abi:${chain}:${contract}`;

  const cached = await getCached(cacheKey);
  if (cached) return cached;

  if (!moduleCache.has(cacheKey)) {
    moduleCache.set(
      cacheKey,
      importAbi(chain, contract).then((abi) => {
        setCache(cacheKey, abi);
        return abi;
      })
    );
  }

  return moduleCache.get(cacheKey)!;
}

export function preloadAbi(chain: EvmChain, contract: string): void {
  if (typeof window === 'undefined') return;
  loadAbi(chain, contract).catch(() => {});
}

export function invalidateAbiCache(chain: EvmChain, contract: string): void {
  const cacheKey = `abi:${chain}:${contract}`;
  moduleCache.delete(cacheKey);
  openDB().then((db) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(cacheKey);
  });
}
