'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseInfiniteScrollOptions {
  /** Whether more items remain. Infinite scrolling never runs when false. */
  hasMore: boolean;
  /** Invoked when the sentinel scrolls into view (or the fallback fires). */
  onLoadMore: () => void | Promise<void>;
  /** True while a page is in flight, used to suppress re-entrant loads. */
  isLoading?: boolean;
  /**
   * Scroll container to observe. When omitted the sentinel uses the document
   * viewport, which is what a normal page scroll needs.
   */
  root?: HTMLElement | null;
  /** `IntersectionObserver` margin. A positive bottom margin prefetches. */
  rootMargin?: string;
  /** Fraction of the sentinel that must be visible before loading. */
  threshold?: number;
  /**
   * Set to false when the caller already detects the end of the list (a
   * virtualised list with its own scroll container, for example). The button
   * keeps working either way.
   */
  enabled?: boolean;
}

export interface UseInfiniteScrollResult {
  /** Attach to the sentinel element rendered at the end of the list. */
  sentinelRef: (node: HTMLElement | null) => void;
  /** True once everything has been loaded, for the end-of-list message. */
  isEndReached: boolean;
  /** Calls `onLoadMore` directly; powers the keyboard-accessible button. */
  loadMore: () => void;
}

/**
 * Drives incremental loading of a long list.
 *
 * Uses `IntersectionObserver` so the next page is requested when a sentinel
 * element reaches the viewport — no scroll listener, no layout thrashing.
 * `loadMore` is exposed separately so the same behaviour is reachable from a
 * button, which is what keyboard users and environments without
 * `IntersectionObserver` fall back to.
 *
 * Re-entrancy is guarded by an in-flight ref that is released when a promise
 * settles, or on the next microtask for a synchronous loader. Releasing it
 * re-attaches the observer, so a sentinel that is still on screen correctly
 * keeps loading until the viewport is full.
 */
export function useInfiniteScroll({
  hasMore,
  onLoadMore,
  isLoading = false,
  root = null,
  rootMargin = '200px',
  threshold = 0,
  enabled = true,
}: UseInfiniteScrollOptions): UseInfiniteScrollResult {
  const [sentinelNode, setSentinelNode] = useState<HTMLElement | null>(null);

  const onLoadMoreRef = useRef(onLoadMore);
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  const inFlightRef = useRef(false);

  const loadMore = useCallback(() => {
    if (!hasMore || inFlightRef.current) return;

    inFlightRef.current = true;

    let result: void | Promise<void>;
    try {
      result = onLoadMoreRef.current();
    } catch {
      inFlightRef.current = false;
      return;
    }

    if (result && typeof result.then === 'function') {
      void result.finally(() => {
        inFlightRef.current = false;
      });
      return;
    }

    // Synchronous loader: release on the next microtask so the observer is
    // re-attached and can fire again if the sentinel is still in view.
    void Promise.resolve().then(() => {
      inFlightRef.current = false;
    });
  }, [hasMore]);

  // Re-observe whenever the sentinel, container, or hasMore/isLoading changes
  // so a stale callback can never fire against a torn-down list.
  useEffect(() => {
    if (!enabled || !hasMore || isLoading || !sentinelNode) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root, rootMargin, threshold }
    );

    observer.observe(sentinelNode);
    return () => observer.disconnect();
  }, [enabled, hasMore, isLoading, loadMore, root, rootMargin, sentinelNode, threshold]);

  const attachSentinel = useCallback((node: HTMLElement | null) => {
    setSentinelNode((current) => (current === node ? current : node));
  }, []);

  return {
    sentinelRef: attachSentinel,
    isEndReached: !hasMore,
    loadMore,
  };
}
