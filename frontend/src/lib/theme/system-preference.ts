/**
 * System colour-scheme preference detection.
 *
 * The app renders dark mode through a `dark` class on <html> (see the
 * `@custom-variant dark (&:is(.dark *))` rule in app/globals.css). When the
 * user picks the "System" theme we need to know what the operating system
 * currently reports and keep tracking it as it changes at runtime.
 *
 * Everything here is defensive: SSR, jsdom and very old Safari all lack parts
 * of the `matchMedia` API, and none of them should throw.
 */

/** Media query that reports whether the OS asks for a dark colour scheme. */
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

function getMediaQueryList(): LegacyMediaQueryList | null {
  if (typeof window === 'undefined') return null;
  if (typeof window.matchMedia !== 'function') return null;

  try {
    return window.matchMedia(DARK_SCHEME_QUERY) as LegacyMediaQueryList;
  } catch {
    return null;
  }
}

/**
 * Returns the colour scheme the operating system currently prefers.
 * Falls back to `false` (light) whenever the query cannot be evaluated.
 */
export function getSystemPrefersDark(): boolean {
  return getMediaQueryList()?.matches ?? false;
}

/**
 * Subscribes to operating-system colour-scheme changes.
 *
 * @param onChange Invoked with the new value whenever the preference flips.
 * @returns An unsubscribe function. Always safe to call, even when
 *          `matchMedia` is unavailable.
 */
export function watchSystemPrefersDark(onChange: (isDark: boolean) => void): () => void {
  const mql = getMediaQueryList();
  if (!mql) return () => {};

  const listener = (event: { matches: boolean }) => onChange(event.matches);

  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', listener as (event: MediaQueryListEvent) => void);
    return () => {
      mql.removeEventListener('change', listener as (event: MediaQueryListEvent) => void);
    };
  }

  // Safari < 14 only exposes the deprecated listener API.
  if (typeof mql.addListener === 'function') {
    mql.addListener(listener as (event: MediaQueryListEvent) => void);
    return () => {
      mql.removeListener?.(listener as (event: MediaQueryListEvent) => void);
    };
  }

  return () => {};
}

/**
 * The theme the user explicitly picked. `system` defers to the OS.
 */
export type ThemePreference = 'light' | 'dark' | 'system';

/** Resolves a preference plus the current OS preference into a concrete flag. */
export function resolveIsDark(preference: ThemePreference, systemPrefersDark: boolean): boolean {
  if (preference === 'system') return systemPrefersDark;
  return preference === 'dark';
}
