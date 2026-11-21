/**
 * lazy-loader.ts
 *
 * Utility for lazy initialization of heavy dependencies.
 * Modules are only loaded on first access, not at process startup.
 * This reduces cold start time by deferring expensive require/import
 * calls until the code path that actually needs them is hit.
 *
 * Usage:
 *   const getOpenAI = lazyLoad(() => import('openai').then(m => new m.default({ apiKey: ... })));
 *   // Later, on first call:
 *   const client = await getOpenAI();
 */

export type LazyFactory<T> = () => Promise<T>;

/**
 * Creates a lazy-initialized singleton.
 * The factory is called at most once; subsequent calls return the cached instance.
 */
export function lazyLoad<T>(factory: LazyFactory<T>): () => Promise<T> {
  let instance: T | undefined;
  let pending: Promise<T> | undefined;

  return async (): Promise<T> => {
    if (instance !== undefined) return instance;
    if (pending) return pending;

    pending = factory().then((result) => {
      instance = result;
      pending = undefined;
      return result;
    });

    return pending;
  };
}

/**
 * Synchronous lazy singleton — for modules that initialize synchronously.
 */
export function lazySyncLoad<T>(factory: () => T): () => T {
  let instance: T | undefined;
  return (): T => {
    if (instance === undefined) {
      instance = factory();
    }
    return instance;
  };
}

/**
 * Registry of all lazy-loaded modules with their load status.
 * Used by the cold-start monitor to report which modules have been initialized.
 */
interface LazyModuleEntry {
  name: string;
  loaded: boolean;
  loadedAt?: number;
  loadDurationMs?: number;
}

const registry = new Map<string, LazyModuleEntry>();

/**
 * Creates a tracked lazy loader that registers itself in the module registry.
 * Useful for monitoring which heavy deps have been loaded.
 */
export function trackedLazyLoad<T>(name: string, factory: LazyFactory<T>): () => Promise<T> {
  registry.set(name, { name, loaded: false });

  let instance: T | undefined;
  let pending: Promise<T> | undefined;

  return async (): Promise<T> => {
    if (instance !== undefined) return instance;
    if (pending) return pending;

    const start = Date.now();
    pending = factory().then((result) => {
      const duration = Date.now() - start;
      instance = result;
      pending = undefined;
      registry.set(name, { name, loaded: true, loadedAt: Date.now(), loadDurationMs: duration });
      return result;
    });

    return pending;
  };
}

export function getLazyModuleRegistry(): LazyModuleEntry[] {
  return Array.from(registry.values());
}
