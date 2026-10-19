'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, GripVertical, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDragOrder } from '@/src/hooks/use-drag-order';

export interface SortableListProps<T> {
  items: readonly T[];
  getId: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** Accessible name for the list and its per-row controls. */
  label: string;
  /** localStorage key holding the order. */
  storageKey?: string;
  /**
   * When false the list renders as a plain ordered list: the stored order is
   * neither applied nor written and no drag controls are offered. Used when the
   * caller is presenting a sorted view rather than a user-defined order.
   */
  enabled?: boolean;
  /** Fired after the order changes, so the caller can switch into manual mode. */
  onOrderChange?: () => void;
  className?: string;
}

/**
 * A reorderable list driven by the native HTML5 drag-and-drop API.
 *
 * Each row is draggable and every row also carries "move up" / "move down"
 * buttons plus a polite live region, so the ordering is fully operable without
 * a pointer. The order is persisted, and a reset control returns to the
 * incoming order.
 */
export function SortableList<T>({
  items,
  getId,
  renderItem,
  label,
  storageKey,
  enabled = true,
  onOrderChange,
  className = '',
}: SortableListProps<T>) {
  const { orderedItems, draggingId, getItemProps, registerItem, nudge, reset, isCustomised } =
    useDragOrder<T>({ items, getId, storageKey, enabled, onCommit: onOrderChange });
  const [announcement, setAnnouncement] = useState('');

  const handleNudge = useCallback(
    (id: string, direction: -1 | 1, position: number) => {
      nudge(id, direction);
      const nextPosition = position + direction;
      setAnnouncement(
        nextPosition < 1
          ? 'Already at the top of the list.'
          : nextPosition > orderedItems.length
            ? 'Already at the bottom of the list.'
            : `Moved to position ${nextPosition} of ${orderedItems.length}.`
      );
    },
    [nudge, orderedItems.length]
  );

  const handleReset = useCallback(() => {
    reset();
    setAnnouncement('Order reset to the default.');
  }, [reset]);

  if (!enabled) {
    return (
      <div className={className} data-testid="sortable-list">
        <ol className="space-y-4" aria-label={label} data-testid="sortable-list-items">
          {orderedItems.map((item, index) => (
            <li key={getId(item)} data-testid="sortable-list-item" data-id={getId(item)}>
              {renderItem(item, index)}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className={className} data-testid="sortable-list">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Drag a card to reorder it, or use the move buttons on each card.
        </p>
        {isCustomised && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="gap-1"
            data-testid="sortable-list-reset"
          >
            <RotateCcw className="h-3 w-3" />
            Reset order
          </Button>
        )}
      </div>

      <ol className="space-y-4" aria-label={label} data-testid="sortable-list-items">
        {orderedItems.map((item, index) => {
          const id = getId(item);
          const dragProps = getItemProps(id);
          const position = index + 1;

          return (
            <li
              key={id}
              ref={(node) => registerItem(id, node)}
              data-testid="sortable-list-item"
              data-id={id}
              data-position={position}
              data-dragging={dragProps['data-dragging']}
              draggable={dragProps.draggable}
              onDragStart={dragProps.onDragStart}
              onDragEnd={dragProps.onDragEnd}
              onDragOver={dragProps.onDragOver}
              onDrop={dragProps.onDrop}
              className={[
                'flex items-start gap-2 rounded-lg transition-opacity',
                draggingId === id ? 'opacity-50' : 'opacity-100',
              ].join(' ')}
            >
              <div
                className="mt-1 flex cursor-grab flex-col items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-2 text-muted-foreground active:cursor-grabbing"
                title="Drag to reorder"
                aria-hidden
              >
                <GripVertical className="h-4 w-4" />
              </div>

              <div className="min-w-0 flex-1">{renderItem(item, index)}</div>

              <div className="flex shrink-0 flex-col gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${label} ${position} of ${orderedItems.length} up`}
                  disabled={index === 0}
                  onClick={() => handleNudge(id, -1, position)}
                  data-testid={`move-up-${id}`}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${label} ${position} of ${orderedItems.length} down`}
                  disabled={index === orderedItems.length - 1}
                  onClick={() => handleNudge(id, 1, position)}
                  data-testid={`move-down-${id}`}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>

      <p role="status" aria-live="polite" className="sr-only" data-testid="sortable-announcer">
        {announcement}
      </p>
    </div>
  );
}

export default SortableList;
