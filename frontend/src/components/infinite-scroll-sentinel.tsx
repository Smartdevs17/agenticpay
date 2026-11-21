'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useInfiniteScroll } from '@/src/hooks/use-infinite-scroll';

export interface InfiniteScrollSentinelProps {
  /** Whether more items remain. */
  hasMore: boolean;
  /** Invoked to request the next page. May be sync or async. */
  onLoadMore: () => void | Promise<void>;
  /** True while a page is in flight. */
  isLoading?: boolean;
  /** Scroll container, when the list does not scroll with the document. */
  root?: HTMLElement | null;
  rootMargin?: string;
  /** Text for the fallback button, e.g. "Load more transactions". */
  loadMoreLabel?: string;
  /** Text shown once everything has loaded. */
  endLabel?: string;
  /** Accessible live-region text announced while loading. */
  loadingLabel?: string;
  /**
   * When true (the default) a sentinel is observed and the next page is
   * requested automatically as it scrolls into view. Set to false when the
   * parent already detects the end of the list — for example a virtualised list
   * with its own scroll container — so loading is not triggered twice.
   */
  autoLoad?: boolean;
  className?: string;
}

/**
 * End-of-list affordance for incremental lists.
 *
 * Renders an observed sentinel plus a real button. The button is not
 * decoration: it keeps the feature usable by keyboard and screen-reader users,
 * and it is the fallback wherever `IntersectionObserver` is unavailable.
 */
export function InfiniteScrollSentinel({
  hasMore,
  onLoadMore,
  isLoading = false,
  root = null,
  rootMargin = '200px',
  loadMoreLabel = 'Load more',
  endLabel = 'You have reached the end of the list',
  loadingLabel = 'Loading more items',
  autoLoad = true,
  className = '',
}: InfiniteScrollSentinelProps) {
  const { sentinelRef, isEndReached, loadMore } = useInfiniteScroll({
    hasMore,
    onLoadMore,
    isLoading,
    root,
    rootMargin,
    enabled: autoLoad,
  });

  return (
    <div
      ref={sentinelRef}
      className={`flex items-center justify-center py-4 ${className}`}
      data-testid="infinite-scroll-sentinel"
      data-has-more={hasMore ? 'true' : 'false'}
    >
      {isLoading ? (
        <span
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          {loadingLabel}
        </span>
      ) : hasMore ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={loadMore}
          data-testid="infinite-scroll-load-more"
        >
          {loadMoreLabel}
        </Button>
      ) : isEndReached ? (
        <p className="text-xs text-muted-foreground" data-testid="infinite-scroll-end">
          {endLabel}
        </p>
      ) : null}
    </div>
  );
}

export default InfiniteScrollSentinel;
