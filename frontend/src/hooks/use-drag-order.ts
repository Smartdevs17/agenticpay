'use client';

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  PROJECT_ORDER_STORAGE_KEY,
  applyProjectOrder,
  moveItem,
  parseProjectOrder,
  resolveDropIndex,
  serializeProjectOrder,
} from '@/src/lib/project-order';

export interface UseDragOrderOptions<T> {
  items: readonly T[];
  getId: (item: T) => string;
  /** localStorage key; defaults to the shared project order key. */
  storageKey?: string;
  /**
   * When false the incoming order is rendered untouched: the stored order is
   * neither applied nor written, and no drag or nudge interaction is offered.
   * Used when the list is being presented in a sorted (non-manual) view.
   */
  enabled?: boolean;
  /** Fired whenever the order is written or cleared, from any interaction. */
  onCommit?: () => void;
}

export interface DragOrderItemProps {
  draggable: boolean;
  'data-dragging'?: boolean;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
}

export interface UseDragOrderResult<T> {
  /** The items in their user-defined order. */
  orderedItems: T[];
  /** Id currently being dragged, or null. */
  draggingId: string | null;
  /** Props to spread onto the card for `id`. */
  getItemProps: (id: string) => DragOrderItemProps;
  /** Registers a card element so its position can be measured while dragging. */
  registerItem: (id: string, node: HTMLElement | null) => void;
  /** Nudges an item one slot up or down; the keyboard equivalent of a drag. */
  nudge: (id: string, direction: -1 | 1) => void;
  /** Restores the incoming order and forgets the stored one. */
  reset: () => void;
  /** True when the user has customised the order. */
  isCustomised: boolean;
}

// ── localStorage-backed external store ─────────────────────────────────────────
//
// The saved order lives in localStorage, which is an external system rather
// than React state. Reading it through useSyncExternalStore keeps the
// server-rendered markup (incoming order) and the first client render
// identical, then applies the stored order right after hydration, without a
// setState-in-effect cascade.

const EMPTY_ORDER: readonly string[] = Object.freeze([]);

const listeners = new Map<string, Set<() => void>>();
const snapshots = new Map<string, { raw: string | null; parsed: string[] }>();

function emit(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

function subscribe(key: string, onStoreChange: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(onStoreChange);

  // Cross-tab sync: another tab writing the same key should reorder this one.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === key) onStoreChange();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);

  return () => {
    set?.delete(onStoreChange);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

function getServerSnapshot(): readonly string[] {
  return EMPTY_ORDER;
}

/** Parsed order, memoised per raw string so getSnapshot stays referentially stable. */
function readSnapshot(key: string): readonly string[] {
  if (typeof window === 'undefined') return EMPTY_ORDER;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return EMPTY_ORDER;
  }

  const cached = snapshots.get(key);
  if (cached && cached.raw === raw) return cached.parsed;

  const parsed = parseProjectOrder(raw);
  snapshots.set(key, { raw, parsed });
  return parsed;
}

function writeOrder(key: string, ids: readonly string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, serializeProjectOrder(ids));
  } catch {
    // Storage can be full or blocked (private mode); the ordering still
    // applies for this session, it just will not be remembered.
  }
  emit(key);
}

function clearOrder(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // See writeOrder — non-fatal.
  }
  emit(key);
}

/**
 * Drag-and-drop ordering with a persisted, keyboard-accessible equivalent.
 *
 * Uses the native HTML5 drag-and-drop API, so no extra dependency is needed.
 * Native drag events are not keyboard-operable, so every drag is mirrored by
 * {@link UseDragOrderResult.nudge} — the card exposes move buttons that call it
 * — otherwise the feature would be mouse-only.
 */
export function useDragOrder<T>({
  items,
  getId,
  storageKey = PROJECT_ORDER_STORAGE_KEY,
  enabled = true,
  onCommit,
}: UseDragOrderOptions<T>): UseDragOrderResult<T> {
  const storedOrder = useSyncExternalStore(
    useCallback((onStoreChange: () => void) => subscribe(storageKey, onStoreChange), [storageKey]),
    useCallback(() => readSnapshot(storageKey), [storageKey]),
    getServerSnapshot
  );

  // Ids that no longer resolve are filtered out of `ordered` but stay in
  // storage until the next user action; every commit writes the fully
  // resolved order, which prunes them.
  const { ordered: manualOrder } = useMemo(
    () => applyProjectOrder(items, storedOrder, getId),
    [getId, items, storedOrder]
  );

  // While reordering is disabled the caller owns the order (e.g. a sorted
  // view), so the stored order must not be layered on top of it.
  const ordered = useMemo(() => (enabled ? manualOrder : [...items]), [enabled, items, manualOrder]);

  const commit = useCallback(
    (next: T[]) => {
      if (!enabled) return;
      writeOrder(storageKey, next.map(getId));
      onCommit?.();
    },
    [enabled, getId, onCommit, storageKey]
  );

  const nudge = useCallback(
    (id: string, direction: -1 | 1) => {
      const from = ordered.findIndex((item) => getId(item) === id);
      if (from === -1) return;
      commit(moveItem(ordered, from, from + direction));
    },
    [commit, getId, ordered]
  );

  // A ref, not state: the node map is a lookup table for measuring, never
  // something that should trigger a render.
  const itemNodes = useRef(new Map<string, HTMLElement>());

  const registerItem = useCallback((id: string, node: HTMLElement | null) => {
    if (node) itemNodes.current.set(id, node);
    else itemNodes.current.delete(id);
  }, []);

  const resolveIndex = useCallback(
    (pointerY: number) => {
      const rects: { top: number; height: number }[] = [];
      for (const item of ordered) {
        const node = itemNodes.current.get(getId(item));
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        rects.push({ top: rect.top, height: rect.height });
      }
      return resolveDropIndex(pointerY, rects);
    },
    [getId, ordered]
  );

  // The drag itself is transient interaction state, not a derivation of the
  // collection, so it belongs in component state.
  const [dragState, setDragState] = useState<{
    draggingId: string | null;
    dropIndex: number | null;
  }>({ draggingId: null, dropIndex: null });

  const getItemProps = useCallback(
    (id: string): DragOrderItemProps => {
      if (!enabled) {
        return {
          draggable: false,
          onDragStart: () => {},
          onDragEnd: () => {},
          onDragOver: () => {},
          onDrop: () => {},
        };
      }

      return {
        draggable: true,
        'data-dragging': dragState.draggingId === id ? true : undefined,
        onDragStart: (event) => {
          event.dataTransfer.effectAllowed = 'move';
          // Firefox refuses to start a drag unless some data is set.
          event.dataTransfer.setData('text/plain', id);
          setDragState({ draggingId: id, dropIndex: null });
        },
        onDragEnd: () => setDragState({ draggingId: null, dropIndex: null }),
        onDragOver: (event) => {
          if (!dragState.draggingId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDragState((current) =>
            current.draggingId === null
              ? current
              : { ...current, dropIndex: resolveIndex(event.clientY) }
          );
        },
        onDrop: (event) => {
          if (!dragState.draggingId) return;
          event.preventDefault();
          const from = ordered.findIndex((item) => getId(item) === dragState.draggingId);
          if (from !== -1) {
            commit(moveItem(ordered, from, dragState.dropIndex ?? ordered.length));
          }
          setDragState({ draggingId: null, dropIndex: null });
        },
      };
    },
    [commit, dragState, enabled, getId, ordered, resolveIndex, setDragState]
  );

  const reset = useCallback(() => {
    if (!enabled) return;
    clearOrder(storageKey);
    onCommit?.();
  }, [enabled, onCommit, storageKey]);

  const isCustomised =
    enabled &&
    storedOrder.length > 0 &&
    storedOrder.join('\u0000') !== items.map(getId).join('\u0000');

  return {
    orderedItems: ordered,
    draggingId: dragState.draggingId,
    getItemProps,
    registerItem,
    nudge,
    reset,
    isCustomised,
  };
}
