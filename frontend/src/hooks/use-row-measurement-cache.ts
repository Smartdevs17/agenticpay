'use client';

import { useCallback, useRef } from 'react';

/**
 * Caches measured row heights for dynamic virtual-list sizing.
 * Invalidates individual entries when content changes.
 */
export function useRowMeasurementCache(defaultHeight: number) {
  const cacheRef = useRef<Map<string | number, number>>(new Map());

  const getHeight = useCallback(
    (id: string | number) => cacheRef.current.get(id) ?? defaultHeight,
    [defaultHeight]
  );

  const setHeight = useCallback((id: string | number, height: number) => {
    const rounded = Math.ceil(height);
    const prev = cacheRef.current.get(id);
    if (prev !== rounded) {
      cacheRef.current.set(id, rounded);
      return true;
    }
    return false;
  }, []);

  const invalidate = useCallback((id: string | number) => {
    cacheRef.current.delete(id);
  }, []);

  const invalidateAll = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  return { getHeight, setHeight, invalidate, invalidateAll };
}
