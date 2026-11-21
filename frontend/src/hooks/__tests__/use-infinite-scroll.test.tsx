import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInfiniteScroll } from '../use-infinite-scroll';

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  static callbacks: ((entries: { isIntersecting: boolean }[]) => void)[] = [];

  observed: Element[] = [];
  disconnected = false;

  constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {
    MockIntersectionObserver.instances.push(this);
    MockIntersectionObserver.callbacks.push(callback);
  }

  observe(node: Element) {
    this.observed.push(node);
  }

  unobserve(node: Element) {
    this.observed = this.observed.filter((element) => element !== node);
  }

  disconnect() {
    this.disconnected = true;
  }

  takeRecords() {
    return [];
  }

  static trigger(isIntersecting: boolean) {
    MockIntersectionObserver.callbacks.forEach((callback) => callback([{ isIntersecting }]));
  }

  static reset() {
    MockIntersectionObserver.instances = [];
    MockIntersectionObserver.callbacks = [];
  }
}

const originalObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  MockIntersectionObserver.reset();
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.IntersectionObserver = originalObserver;
  vi.useRealTimers();
});

describe('useInfiniteScroll', () => {
  it('observes the attached sentinel', async () => {
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, onLoadMore: vi.fn() })
    );

    const node = document.createElement('div');
    act(() => result.current.sentinelRef(node));

    expect(MockIntersectionObserver.instances).toHaveLength(1);
    expect(MockIntersectionObserver.instances[0].observed).toEqual([node]);
  });

  it('loads the next page when the sentinel intersects', async () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() => useInfiniteScroll({ hasMore: true, onLoadMore }));

    const node = document.createElement('div');
    act(() => result.current.sentinelRef(node));

    await act(async () => {
      MockIntersectionObserver.trigger(true);
    });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('ignores a non-intersecting notification', async () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() => useInfiniteScroll({ hasMore: true, onLoadMore }));

    const node = document.createElement('div');
    act(() => result.current.sentinelRef(node));

    await act(async () => {
      MockIntersectionObserver.trigger(false);
    });

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does not observe when there is nothing more to load', () => {
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: false, onLoadMore: vi.fn() })
    );

    act(() => result.current.sentinelRef(document.createElement('div')));

    expect(MockIntersectionObserver.instances).toHaveLength(0);
    expect(result.current.isEndReached).toBe(true);
  });

  it('does not observe while a page is loading', () => {
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, isLoading: true, onLoadMore: vi.fn() })
    );

    act(() => result.current.sentinelRef(document.createElement('div')));

    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });

  it('does not observe when auto-loading is disabled', () => {
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, enabled: false, onLoadMore: vi.fn() })
    );

    act(() => result.current.sentinelRef(document.createElement('div')));

    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });

  it('survives a missing IntersectionObserver by using the button', () => {
    vi.stubGlobal('IntersectionObserver', undefined);

    const onLoadMore = vi.fn();
    const { result } = renderHook(() => useInfiniteScroll({ hasMore: true, onLoadMore }));

    act(() => result.current.sentinelRef(document.createElement('div')));
    act(() => result.current.loadMore());

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('loadMore is a no-op when nothing more remains', () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() => useInfiniteScroll({ hasMore: false, onLoadMore }));

    act(() => result.current.loadMore());

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('guards against re-entrant loads from a synchronous loader', async () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() => useInfiniteScroll({ hasMore: true, onLoadMore }));

    const node = document.createElement('div');
    act(() => result.current.sentinelRef(node));

    // Two notifications in the same tick must only produce one load.
    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Once the microtask releases the guard, loading resumes.
    await act(async () => {
      await Promise.resolve();
    });
    act(() => result.current.loadMore());
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('keeps the guard until an async loader settles', async () => {
    let resolveLoad: (() => void) | undefined;
    const onLoadMore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        })
    );
    const { result } = renderHook(() => useInfiniteScroll({ hasMore: true, onLoadMore }));

    act(() => result.current.loadMore());
    act(() => result.current.loadMore());
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveLoad?.();
    });
    act(() => result.current.loadMore());
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('releases the guard when a loader throws', () => {
    const onLoadMore = vi.fn(() => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => useInfiniteScroll({ hasMore: true, onLoadMore }));

    expect(() => act(() => result.current.loadMore())).not.toThrow();
    act(() => result.current.loadMore());
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('uses the latest onLoadMore callback', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ onLoadMore }: { onLoadMore: () => void }) =>
        useInfiniteScroll({ hasMore: true, onLoadMore }),
      { initialProps: { onLoadMore: first } }
    );

    rerender({ onLoadMore: second });
    act(() => result.current.loadMore());

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('disconnects the observer on unmount', () => {
    const { result, unmount } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, onLoadMore: vi.fn() })
    );

    const node = document.createElement('div');
    act(() => result.current.sentinelRef(node));
    const observer = MockIntersectionObserver.instances[0];

    unmount();
    expect(observer.disconnected).toBe(true);
  });

  it('detaches the sentinel when it is unmounted', () => {
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, onLoadMore: vi.fn() })
    );

    act(() => result.current.sentinelRef(document.createElement('div')));
    act(() => result.current.sentinelRef(null));
    expect(MockIntersectionObserver.instances.at(-1)?.disconnected).toBe(true);
  });

  it('observes a caller-supplied scroll container', () => {
    const root = document.createElement('div');
    const seen: (IntersectionObserverInit | undefined)[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(_cb: unknown, init?: IntersectionObserverInit) {
          seen.push(init);
        }
        observe() {}
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
      }
    );

    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, onLoadMore: vi.fn(), root, rootMargin: '50px' })
    );
    act(() => result.current.sentinelRef(document.createElement('div')));

    expect(seen[0]).toMatchObject({ root, rootMargin: '50px' });
  });
});

describe('useInfiniteScroll in a component', () => {
  it('drives a rendered list from the observer', async () => {
    const onLoadMore = vi.fn();

    function List() {
      const { sentinelRef } = useInfiniteScroll({ hasMore: true, onLoadMore });
      return <div ref={sentinelRef} data-testid="sentinel" />;
    }

    render(<List />);
    expect(screen.getByTestId('sentinel')).toBeInTheDocument();

    await act(async () => {
      MockIntersectionObserver.trigger(true);
    });
    expect(onLoadMore).toHaveBeenCalled();
  });
});
