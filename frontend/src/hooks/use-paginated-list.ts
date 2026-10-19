'use client';

import { useCallback, useMemo, useState } from 'react';

export interface UsePaginatedListOptions {
  /** The full collection, in display order. */
  items: readonly unknown[];
  /** Number of items revealed per page. */
  pageSize?: number;
  /** Initial number of visible items. Defaults to `pageSize`. */
  initialCount?: number;
}

export interface UsePaginatedListResult<T> {
  /** The slice that should currently be rendered. */
  visibleItems: T[];
  /** How many items are currently visible. */
  visibleCount: number;
  /** True when at least one more item is available. */
  hasMore: boolean;
  /** True when everything is already revealed. */
  isComplete: boolean;
  /** Reveals the next page. A no-op once `hasMore` is false. */
  loadMore: () => void;
  /** Reverts to the first page, e.g. when a filter changes. */
  reset: () => void;
}

export const DEFAULT_PAGE_SIZE = 20;

/**
 * Client-side incremental paging for an already-loaded collection.
 *
 * The payments feed is synthesised on the client from on-chain projects rather
 * than fetched page by page, so the list is complete in memory but must not be
 * painted all at once. This hook reveals it in fixed-size pages, which is what
 * `useInfiniteScroll` consumes to keep appending as the user scrolls.
 *
 * Note that `items` is intentionally not a dependency of any effect: callers
 * typically rebuild the array on every render, so keying state on its identity
 * would reset the window continuously. Call {@link UsePaginatedListResult.reset}
 * explicitly when the underlying collection is genuinely replaced.
 */
export function usePaginatedList<T>({
  items,
  pageSize = DEFAULT_PAGE_SIZE,
  initialCount,
}: UsePaginatedListOptions): UsePaginatedListResult<T> {
  const firstPage = initialCount ?? pageSize;
  const [visibleCount, setVisibleCount] = useState(firstPage);

  // Clamp so a shrinking collection can never leave us past the end.
  const count = Math.min(visibleCount, items.length);

  const visibleItems = useMemo(
    () => (items as readonly T[]).slice(0, count),
    [items, count]
  );

  const hasMore = count < items.length;

  const loadMore = useCallback(() => {
    setVisibleCount((current) => current + pageSize);
  }, [pageSize]);

  const reset = useCallback(() => {
    setVisibleCount(firstPage);
  }, [firstPage]);

  return {
    visibleItems,
    visibleCount: visibleItems.length,
    hasMore,
    isComplete: !hasMore,
    loadMore,
    reset,
  };
}
