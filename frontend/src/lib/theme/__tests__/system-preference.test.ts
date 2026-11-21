import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DARK_SCHEME_QUERY,
  getSystemPrefersDark,
  resolveIsDark,
  watchSystemPrefersDark,
} from '../system-preference';

type Listener = (event: { matches: boolean }) => void;

function stubMatchMedia(
  impl: (query: string) => Partial<MediaQueryList> | undefined
): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: impl,
  });
}

function makeMql(matches: boolean) {
  const listeners = new Set<Listener>();
  const mql = {
    matches,
    media: DARK_SCHEME_QUERY,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    addListener: (listener: Listener) => listeners.add(listener),
    removeListener: (listener: Listener) => listeners.delete(listener),
    emit(next: boolean) {
      mql.matches = next;
      listeners.forEach((listener) => listener({ matches: next }));
    },
    get size() {
      return listeners.size;
    },
  };
  return mql;
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
  vi.restoreAllMocks();
});

describe('getSystemPrefersDark', () => {
  it('reports the OS preference from matchMedia', () => {
    stubMatchMedia((query) => ({ matches: query === DARK_SCHEME_QUERY }) as Partial<MediaQueryList>);
    expect(getSystemPrefersDark()).toBe(true);
  });

  it('returns false when the OS prefers light', () => {
    stubMatchMedia(() => ({ matches: false }) as Partial<MediaQueryList>);
    expect(getSystemPrefersDark()).toBe(false);
  });

  it('falls back to false when matchMedia is missing', () => {
    stubMatchMedia(() => undefined as unknown as MediaQueryList);
    expect(getSystemPrefersDark()).toBe(false);
  });

  it('falls back to false when matchMedia is not a function', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    expect(getSystemPrefersDark()).toBe(false);
  });

  it('falls back to false when matchMedia throws', () => {
    stubMatchMedia(() => {
      throw new Error('unsupported query');
    });
    expect(getSystemPrefersDark()).toBe(false);
  });
});

describe('watchSystemPrefersDark', () => {
  it('subscribes through the modern listener API and reports changes', () => {
    const mql = makeMql(false);
    stubMatchMedia(() => mql as unknown as Partial<MediaQueryList>);

    const seen: boolean[] = [];
    const unsubscribe = watchSystemPrefersDark((isDark) => seen.push(isDark));

    expect(mql.size).toBe(1);
    mql.emit(true);
    mql.emit(false);
    expect(seen).toEqual([true, false]);

    unsubscribe();
    expect(mql.size).toBe(0);
  });

  it('falls back to the deprecated addListener API', () => {
    const mql = makeMql(false);
    // Simulate Safari < 14, which has no addEventListener.
    (mql as unknown as { addEventListener: unknown }).addEventListener = undefined;
    stubMatchMedia(() => mql as unknown as Partial<MediaQueryList>);

    const seen: boolean[] = [];
    const unsubscribe = watchSystemPrefersDark((isDark) => seen.push(isDark));

    expect(mql.size).toBe(1);
    mql.emit(true);
    expect(seen).toEqual([true]);

    unsubscribe();
    expect(mql.size).toBe(0);
  });

  it('returns a no-op unsubscribe when no listener API exists', () => {
    const mql = makeMql(false);
    (mql as unknown as { addEventListener: unknown }).addEventListener = undefined;
    (mql as unknown as { addListener: unknown }).addListener = undefined;
    stubMatchMedia(() => mql as unknown as Partial<MediaQueryList>);

    const onChange = vi.fn();
    const unsubscribe = watchSystemPrefersDark(onChange);

    expect(onChange).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  it('returns a no-op unsubscribe when matchMedia is unavailable', () => {
    stubMatchMedia(() => undefined as unknown as MediaQueryList);
    const onChange = vi.fn();
    const unsubscribe = watchSystemPrefersDark(onChange);

    expect(onChange).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe('resolveIsDark', () => {
  it('defers to the OS in system mode', () => {
    expect(resolveIsDark('system', true)).toBe(true);
    expect(resolveIsDark('system', false)).toBe(false);
  });

  it('ignores the OS for explicit preferences', () => {
    expect(resolveIsDark('dark', false)).toBe(true);
    expect(resolveIsDark('light', true)).toBe(false);
  });
});
