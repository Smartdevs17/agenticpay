import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAGE_SIZE, usePaginatedList } from '../use-paginated-list';

function makeItems(count: number) {
  return Array.from({ length: count }, (_, index) => `item-${index + 1}`);
}

describe('usePaginatedList', () => {
  it('reveals a single page by default', () => {
    const items = makeItems(55);
    const { result } = renderHook(() => usePaginatedList<string>({ items }));

    expect(result.current.visibleItems).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.isComplete).toBe(false);
  });

  it('honours a custom pageSize', () => {
    const items = makeItems(10);
    const { result } = renderHook(() => usePaginatedList<string>({ items, pageSize: 4 }));

    expect(result.current.visibleItems).toEqual(['item-1', 'item-2', 'item-3', 'item-4']);
  });

  it('honours an explicit initialCount', () => {
    const items = makeItems(30);
    const { result } = renderHook(() =>
      usePaginatedList<string>({ items, pageSize: 5, initialCount: 12 })
    );

    expect(result.current.visibleCount).toBe(12);
  });

  it('appends the next page on loadMore', () => {
    const items = makeItems(10);
    const { result } = renderHook(() => usePaginatedList<string>({ items, pageSize: 3 }));

    act(() => result.current.loadMore());
    expect(result.current.visibleItems).toEqual(['item-1', 'item-2', 'item-3', 'item-4', 'item-5', 'item-6']);
    expect(result.current.hasMore).toBe(true);
  });

  it('reports completion once every item is revealed', () => {
    const items = makeItems(4);
    const { result } = renderHook(() => usePaginatedList<string>({ items, pageSize: 2 }));

    act(() => result.current.loadMore());

    expect(result.current.visibleItems).toHaveLength(4);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.isComplete).toBe(true);
  });

  it('reports completion when there are fewer items than one page', () => {
    const { result } = renderHook(() => usePaginatedList<string>({ items: makeItems(2) }));
    expect(result.current.isComplete).toBe(true);
    expect(result.current.hasMore).toBe(false);
  });

  it('reports completion for an empty collection', () => {
    const { result } = renderHook(() => usePaginatedList<string>({ items: [] }));
    expect(result.current.visibleItems).toEqual([]);
    expect(result.current.isComplete).toBe(true);
  });

  it('clamps the window when the collection shrinks', async () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: string[] }) => usePaginatedList<string>({ items, pageSize: 2 }),
      { initialProps: { items: makeItems(6) } }
    );

    act(() => result.current.loadMore());
    act(() => result.current.loadMore());
    expect(result.current.visibleCount).toBe(6);

    rerender({ items: makeItems(3) });
    await waitFor(() => expect(result.current.visibleItems).toHaveLength(3));
    expect(result.current.hasMore).toBe(false);
  });

  it('keeps the revealed window when the collection identity changes', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: string[] }) => usePaginatedList<string>({ items, pageSize: 2 }),
      { initialProps: { items: makeItems(6) } }
    );

    act(() => result.current.loadMore());
    expect(result.current.visibleCount).toBe(4);

    // A new array with the same content, as a fresh query result would produce.
    rerender({ items: makeItems(6) });
    expect(result.current.visibleCount).toBe(4);
  });

  it('reset returns to the first page', () => {
    const items = makeItems(10);
    const { result } = renderHook(() => usePaginatedList<string>({ items, pageSize: 3 }));

    act(() => result.current.loadMore());
    expect(result.current.visibleCount).toBe(6);

    act(() => result.current.reset());
    expect(result.current.visibleCount).toBe(3);
  });

  it('keeps the in-flight loadMore callback stable', () => {
    const items = makeItems(10);
    const { result, rerender } = renderHook(
      ({ items }: { items: string[] }) => usePaginatedList<string>({ items, pageSize: 3 }),
      { initialProps: { items } }
    );

    const first = result.current.loadMore;
    rerender({ items: makeItems(10) });
    expect(result.current.loadMore).toBe(first);
  });
});

describe('usePaginatedList guards', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('never overshoots the collection', () => {
    const { result } = renderHook(() => usePaginatedList<string>({ items: makeItems(3), pageSize: 2 }));

    act(() => {
      result.current.loadMore();
      result.current.loadMore();
      result.current.loadMore();
    });

    expect(result.current.visibleItems).toHaveLength(3);
    expect(result.current.hasMore).toBe(false);
  });
});
