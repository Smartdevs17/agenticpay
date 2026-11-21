import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDragOrder } from '../use-drag-order';
import { PROJECT_ORDER_STORAGE_KEY } from '@/src/lib/project-order';

interface Project {
  id: string;
}

const items: Project[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const getId = (project: Project) => project.id;
const STORAGE_KEY = 'test-project-order';

function seedOrder(order: string) {
  window.localStorage.setItem(STORAGE_KEY, order);
}

function storedOrder(): string | null {
  return window.localStorage.getItem(STORAGE_KEY);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('useDragOrder', () => {
  it('returns the incoming order when nothing is stored', () => {
    const { result } = renderHook(() => useDragOrder({ items, getId, storageKey: STORAGE_KEY }));
    expect(result.current.orderedItems.map(getId)).toEqual(['a', 'b', 'c']);
    expect(result.current.isCustomised).toBe(false);
  });

  it('applies a stored order', () => {
    seedOrder('["c","b","a"]');
    const { result } = renderHook(() => useDragOrder({ items, getId, storageKey: STORAGE_KEY }));
    expect(result.current.orderedItems.map(getId)).toEqual(['c', 'b', 'a']);
    expect(result.current.isCustomised).toBe(true);
  });

  it('reports isCustomised when the stored order matches the incoming order', () => {
    seedOrder('["a","b","c"]');
    const { result } = renderHook(() => useDragOrder({ items, getId, storageKey: STORAGE_KEY }));
    expect(result.current.isCustomised).toBe(false);
  });

  it('defaults to the shared project order key', () => {
    seedOrder(`["c","a","b"]`);
    window.localStorage.setItem(PROJECT_ORDER_STORAGE_KEY, '["c","a","b"]');
    const { result } = renderHook(() => useDragOrder({ items, getId }));
    expect(result.current.orderedItems.map(getId)).toEqual(['c', 'a', 'b']);
  });

  it('persists the order after a nudge', () => {
    const { result } = renderHook(() => useDragOrder({ items, getId, storageKey: STORAGE_KEY }));

    act(() => result.current.nudge('a', 1));

    expect(JSON.parse(storedOrder() ?? '[]')).toEqual(['b', 'a', 'c']);
    expect(result.current.orderedItems.map(getId)).toEqual(['b', 'a', 'c']);
  });

  it('ignores a nudge for an unknown id', () => {
    const { result } = renderHook(() => useDragOrder({ items, getId, storageKey: STORAGE_KEY }));

    act(() => result.current.nudge('missing', 1));

    expect(storedOrder()).toBeNull();
  });

  it('ignores a nudge that would move past the end', () => {
    seedOrder('["a","b","c"]');
    const { result } = renderHook(() => useDragOrder({ items, getId, storageKey: STORAGE_KEY }));

    act(() => result.current.nudge('c', 1));

    expect(JSON.parse(storedOrder() ?? '[]')).toEqual(['a', 'b', 'c']);
  });

  it('clears the stored order on reset', () => {
    seedOrder('["c","b","a"]');
    const { result } = renderHook(() => useDragOrder({ items, getId, storageKey: STORAGE_KEY }));

    act(() => result.current.reset());

    expect(storedOrder()).toBeNull();
    expect(result.current.orderedItems.map(getId)).toEqual(['a', 'b', 'c']);
    expect(result.current.isCustomised).toBe(false);
  });

  it('reports the dragging id through getItemProps', () => {
    const { result } = renderHook(() => useDragOrder({ items, getId, storageKey: STORAGE_KEY }));

    const props = result.current.getItemProps('a');
    expect(props.draggable).toBe(true);
    expect(props['data-dragging']).toBeUndefined();

    act(() => {
      props.onDragStart({
        dataTransfer: { effectAllowed: '', setData: vi.fn() },
      } as unknown as React.DragEvent);
    });

    expect(result.current.draggingId).toBe('a');
    expect(result.current.getItemProps('a')['data-dragging']).toBe(true);
    expect(result.current.getItemProps('b')['data-dragging']).toBeUndefined();
  });

  it('clears the dragging id on drag end', () => {
    const { result } = renderHook(() => useDragOrder({ items, getId, storageKey: STORAGE_KEY }));

    act(() => {
      result.current.getItemProps('a').onDragStart({
        dataTransfer: { effectAllowed: '', setData: vi.fn() },
      } as unknown as React.DragEvent);
    });
    expect(result.current.draggingId).toBe('a');

    act(() => {
      result.current.getItemProps('a').onDragEnd({} as React.DragEvent);
    });
    expect(result.current.draggingId).toBeNull();
  });

  it('sets data on drag start so Firefox starts the drag', () => {
    const setData = vi.fn();
    const { result } = renderHook(() => useDragOrder({ items, getId, storageKey: STORAGE_KEY }));

    act(() => {
      result.current.getItemProps('a').onDragStart({
        dataTransfer: { effectAllowed: '', setData },
      } as unknown as React.DragEvent);
    });

    expect(setData).toHaveBeenCalledWith('text/plain', 'a');
  });

  it('ignores drag over and drop when nothing is being dragged', () => {
    const { result } = renderHook(() => useDragOrder({ items, getId, storageKey: STORAGE_KEY }));

    act(() => {
      result.current.getItemProps('a').onDragOver({
        preventDefault: vi.fn(),
        clientY: 0,
        dataTransfer: { dropEffect: '' },
      } as unknown as React.DragEvent);
      result.current.getItemProps('a').onDrop({ preventDefault: vi.fn() } as unknown as React.DragEvent);
    });

    expect(storedOrder()).toBeNull();
  });

  it('commits the order on drop', () => {
    const { result } = renderHook(() => useDragOrder({ items, getId, storageKey: STORAGE_KEY }));

    act(() => {
      result.current.getItemProps('a').onDragStart({
        dataTransfer: { effectAllowed: '', setData: vi.fn() },
      } as unknown as React.DragEvent);
    });

    act(() => {
      result.current.getItemProps('a').onDrop({
        preventDefault: vi.fn(),
        dataTransfer: { dropEffect: '' },
      } as unknown as React.DragEvent & { clientY: number });
    });

    // With no measured rects the drop index falls back to the end of the list.
    expect(JSON.parse(storedOrder() ?? '[]')).toEqual(['b', 'c', 'a']);
    expect(result.current.draggingId).toBeNull();
  });

  it('calls onCommit after a nudge and after a reset', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDragOrder({ items, getId, storageKey: STORAGE_KEY, onCommit })
    );

    act(() => result.current.nudge('a', 1));
    expect(onCommit).toHaveBeenCalledTimes(1);

    act(() => result.current.reset());
    expect(onCommit).toHaveBeenCalledTimes(2);
  });
});

describe('useDragOrder when disabled', () => {
  it('ignores a stored order and renders the incoming order', () => {
    seedOrder('["c","b","a"]');
    const { result } = renderHook(() =>
      useDragOrder({ items, getId, storageKey: STORAGE_KEY, enabled: false })
    );

    expect(result.current.orderedItems.map(getId)).toEqual(['a', 'b', 'c']);
    expect(result.current.isCustomised).toBe(false);
  });

  it('marks every item as not draggable', () => {
    const { result } = renderHook(() =>
      useDragOrder({ items, getId, storageKey: STORAGE_KEY, enabled: false })
    );

    for (const id of ['a', 'b', 'c']) {
      const props = result.current.getItemProps(id);
      expect(props.draggable).toBe(false);
      expect(props['data-dragging']).toBeUndefined();
      expect(() => {
        props.onDragStart({ dataTransfer: { setData: vi.fn() } } as unknown as React.DragEvent);
        props.onDragOver({ preventDefault: vi.fn() } as unknown as React.DragEvent);
        props.onDrop({ preventDefault: vi.fn() } as unknown as React.DragEvent);
        props.onDragEnd({} as React.DragEvent);
      }).not.toThrow();
    }
  });

  it('never writes to storage', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useDragOrder({ items, getId, storageKey: STORAGE_KEY, enabled: false, onCommit })
    );

    act(() => result.current.nudge('a', 1));
    act(() => result.current.reset());

    expect(storedOrder()).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('keeps the incoming array order when the collection shrinks', () => {
    seedOrder('["c","b","a"]');
    const { result } = renderHook(() =>
      useDragOrder({
        items: [{ id: 'a' }, { id: 'b' }],
        getId,
        storageKey: STORAGE_KEY,
        enabled: false,
      })
    );

    expect(result.current.orderedItems.map(getId)).toEqual(['a', 'b']);
  });
});
