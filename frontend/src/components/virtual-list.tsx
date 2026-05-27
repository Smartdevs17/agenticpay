'use client';

/**
 * VirtualList — Issue #216
 *
 * Windowed list rendering for 1000+ row datasets. Only renders visible rows
 * plus a configurable overscan buffer, keeping the DOM count stable
 * regardless of total item count.
 *
 * Features:
 *  - Fixed or dynamic row heights
 *  - Infinite scroll with `onLoadMore` callback
 *  - Fixed header during scroll
 *  - Keyboard navigation (↑/↓/Home/End/PgUp/PgDn)
 *  - ARIA live-region for screen-reader updates
 *  - Scroll position restoration via `scrollKey`
 *  - Export selection via `onExport`
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type CSSProperties,
} from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface VirtualListItem {
  id: string | number;
  /** Optional explicit row height in px; falls back to `estimatedRowHeight`. */
  height?: number;
}

export interface VirtualListProps<T extends VirtualListItem> {
  items: T[];
  /** Height of the scrollable container in px. */
  containerHeight: number;
  /** Default row height in px (used when `item.height` is absent). */
  estimatedRowHeight?: number;
  /** Number of extra rows to render above and below the visible window. */
  overscan?: number;
  /** Render function for each row. */
  renderRow: (item: T, index: number, isSelected: boolean) => ReactNode;
  /** Optional sticky header rendered above the scrollable area. */
  header?: ReactNode;
  /** Called when the user scrolls within `threshold`px of the bottom. */
  onLoadMore?: () => void;
  /** px from bottom to trigger onLoadMore (default 200). */
  loadMoreThreshold?: number;
  /** Whether more data is loading (shows a spinner at the bottom). */
  isLoading?: boolean;
  /** Content to show when `items` is empty. */
  emptyState?: ReactNode;
  /** Stable key for scroll-position restoration across mounts. */
  scrollKey?: string;
  /** IDs of initially selected items. */
  selectedIds?: Set<string | number>;
  onSelectionChange?: (ids: Set<string | number>) => void;
  /** Called with the currently selected items when the user triggers export. */
  onExport?: (selected: T[]) => void;
  className?: string;
}

// ── Scroll position store ──────────────────────────────────────────────────────

const scrollStore = new Map<string, number>();

// ── Hook: compute visible range ────────────────────────────────────────────────

function useVisibleRange(
  scrollTop: number,
  containerHeight: number,
  rowHeights: number[],
  overscan: number
) {
  return useMemo(() => {
    let offset = 0;
    let startIndex = 0;
    for (let i = 0; i < rowHeights.length; i++) {
      if (offset + rowHeights[i] > scrollTop - overscan * rowHeights[i]) {
        startIndex = Math.max(0, i - overscan);
        break;
      }
      offset += rowHeights[i];
    }

    let visibleEnd = 0;
    let endIndex = startIndex;
    offset = rowHeights.slice(0, startIndex).reduce((a, b) => a + b, 0);
    for (let i = startIndex; i < rowHeights.length; i++) {
      if (offset > scrollTop + containerHeight + overscan * rowHeights[i]) {
        endIndex = Math.min(rowHeights.length - 1, i + overscan);
        break;
      }
      offset += rowHeights[i];
      endIndex = i;
    }

    const totalHeight = rowHeights.reduce((a, b) => a + b, 0);
    const offsetTop = rowHeights.slice(0, startIndex).reduce((a, b) => a + b, 0);
    const offsetBottom = totalHeight - rowHeights.slice(0, endIndex + 1).reduce((a, b) => a + b, 0);

    return { startIndex, endIndex, totalHeight, offsetTop, offsetBottom };
  }, [scrollTop, containerHeight, rowHeights, overscan]);
}

// ── Component ──────────────────────────────────────────────────────────────────

export function VirtualList<T extends VirtualListItem>({
  items,
  containerHeight,
  estimatedRowHeight = 48,
  overscan = 5,
  renderRow,
  header,
  onLoadMore,
  loadMoreThreshold = 200,
  isLoading = false,
  emptyState,
  scrollKey,
  selectedIds: controlledSelectedIds,
  onSelectionChange,
  onExport,
  className = '',
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  // Internal selection state (uncontrolled unless controlledSelectedIds provided)
  const [internalSelected, setInternalSelected] = useState<Set<string | number>>(new Set());
  const selectedIds = controlledSelectedIds ?? internalSelected;

  const setSelected = useCallback(
    (next: Set<string | number>) => {
      if (!controlledSelectedIds) setInternalSelected(next);
      onSelectionChange?.(next);
    },
    [controlledSelectedIds, onSelectionChange]
  );

  // Build row heights array
  const rowHeights = useMemo(
    () => items.map((item) => item.height ?? estimatedRowHeight),
    [items, estimatedRowHeight]
  );

  const { startIndex, endIndex, totalHeight, offsetTop, offsetBottom } =
    useVisibleRange(scrollTop, containerHeight, rowHeights, overscan);

  // Restore scroll position
  useLayoutEffect(() => {
    if (scrollKey && scrollStore.has(scrollKey) && scrollRef.current) {
      scrollRef.current.scrollTop = scrollStore.get(scrollKey)!;
    }
  }, [scrollKey]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    setScrollTop(top);

    if (scrollKey) scrollStore.set(scrollKey, top);

    // Infinite scroll trigger
    if (onLoadMore && !isLoading) {
      const distanceFromBottom = el.scrollHeight - top - el.clientHeight;
      if (distanceFromBottom < loadMoreThreshold) onLoadMore();
    }
  }, [scrollKey, onLoadMore, isLoading, loadMoreThreshold]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const count = items.length;
      if (!count) return;

      const current = focusedIndex ?? 0;
      let next = current;

      switch (e.key) {
        case 'ArrowDown': next = Math.min(count - 1, current + 1); break;
        case 'ArrowUp':   next = Math.max(0, current - 1);         break;
        case 'Home':      next = 0;                                break;
        case 'End':       next = count - 1;                        break;
        case 'PageDown':  next = Math.min(count - 1, current + 10); break;
        case 'PageUp':    next = Math.max(0, current - 10);         break;
        case ' ':
        case 'Enter': {
          if (focusedIndex != null) {
            const id = items[focusedIndex].id;
            const next = new Set(selectedIds);
            if (next.has(id)) next.delete(id); else next.add(id);
            setSelected(next);
          }
          return;
        }
        default: return;
      }

      e.preventDefault();
      setFocusedIndex(next);

      // Scroll focused row into view
      const el = scrollRef.current;
      if (el) {
        const rowTop = rowHeights.slice(0, next).reduce((a, b) => a + b, 0);
        const rowH = rowHeights[next];
        if (rowTop < el.scrollTop) el.scrollTop = rowTop;
        else if (rowTop + rowH > el.scrollTop + containerHeight)
          el.scrollTop = rowTop + rowH - containerHeight;
      }
    },
    [focusedIndex, items, rowHeights, containerHeight, selectedIds, setSelected]
  );

  const visibleItems = items.slice(startIndex, endIndex + 1);
  const liveMessage =
    items.length === 0
      ? 'No items'
      : `Showing rows ${startIndex + 1}–${endIndex + 1} of ${items.length}`;

  return (
    <div className={`flex flex-col ${className}`} style={{ height: containerHeight + (header ? 0 : 0) }}>
      {/* Fixed header */}
      {header && (
        <div className="sticky top-0 z-10 bg-background border-b border-border">
          {header}
        </div>
      )}

      {/* Export toolbar */}
      {onExport && selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 border-b text-sm">
          <span>{selectedIds.size} selected</span>
          <button
            onClick={() => onExport(items.filter((i) => selectedIds.has(i.id)))}
            className="ml-auto px-3 py-1 rounded bg-primary text-primary-foreground text-xs"
          >
            Export
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="px-2 py-1 rounded border text-xs"
          >
            Clear
          </button>
        </div>
      )}

      {/* ARIA live region */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveMessage}
      </span>

      {/* Scrollable list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        role="listbox"
        aria-multiselectable="true"
        aria-label="Data list"
        tabIndex={0}
        style={{ height: containerHeight, overflowY: 'auto', outline: 'none' }}
      >
        {items.length === 0 && !isLoading ? (
          emptyState ?? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No items to display
            </div>
          )
        ) : (
          <div style={{ height: totalHeight, position: 'relative' }}>
            {/* Top spacer */}
            <div style={{ height: offsetTop }} aria-hidden />

            {visibleItems.map((item, localIdx) => {
              const globalIdx = startIndex + localIdx;
              const isSelected = selectedIds.has(item.id);
              const isFocused = focusedIndex === globalIdx;
              const rowStyle: CSSProperties = {
                height: item.height ?? estimatedRowHeight,
              };

              return (
                <div
                  key={item.id}
                  role="option"
                  aria-selected={isSelected}
                  data-focused={isFocused || undefined}
                  style={rowStyle}
                  onClick={() => {
                    setFocusedIndex(globalIdx);
                    const next = new Set(selectedIds);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    setSelected(next);
                  }}
                  className={[
                    'cursor-pointer select-none transition-colors',
                    isSelected ? 'bg-primary/10' : 'hover:bg-muted/50',
                    isFocused ? 'ring-2 ring-ring ring-inset' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {renderRow(item, globalIdx, isSelected)}
                </div>
              );
            })}

            {/* Bottom spacer */}
            <div style={{ height: offsetBottom }} aria-hidden />
          </div>
        )}

        {isLoading && (
          <div className="flex justify-center py-4 text-muted-foreground text-sm">
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}

export default VirtualList;
