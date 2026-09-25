'use client';

import { useEffect, useRef } from 'react';
import { useThemeStore } from '@/store/useThemeStore';
import { getSunTimes } from '@/lib/theme/sunriseSunset';
import { getSystemPrefersDark, watchSystemPrefersDark } from '@/src/lib/theme/system-preference';

/** Duration (ms) to pre-enable CSS transition before toggling the class. */
//const TRANSITION_PREP_MS = 50;

/**
 * Single place where the resolved `dark` flag is mirrored onto <html>.
 * The store owns the value; the DOM is only ever a reflection of it.
 */
export function applyDark(isDark: boolean) {
  const root = document.documentElement;
  root.classList.toggle('dark', isDark);
}

/**
 * Checks whether "now" falls within the dark period.
 * Handles ranges that wrap past midnight (e.g., 20:00 → 07:00).
 */
function isDarkNow(now: Date, startHour: number, endHour: number): boolean {
  const h = now.getHours();
  if (startHour > endHour) {
    // Wraps midnight: dark from startHour..23 and 0..endHour
    return h >= startHour || h < endHour;
  }
  return h >= startHour && h < endHour;
}

function isDarkBySun(now: Date, sunrise: Date, sunset: Date): boolean {
  return now < sunrise || now > sunset;
}

export function useScheduledTheme() {
  const { mode, isDark, startHour, endHour, latitude, longitude, setIsDark } = useThemeStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Apply the current persisted dark value once on mount (avoids flash). */
  useEffect(() => {
    applyDark(isDark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Sync whenever isDark changes (from store). */
  useEffect(() => {
    applyDark(isDark);
  }, [isDark]);

  /**
   * System mode — mirror the OS colour-scheme preference and keep following it
   * while the user is on this mode. The listener is torn down on mode change.
   */
  useEffect(() => {
    if (mode !== 'system') return;

    const sync = (prefersDark: boolean) => {
      const { systemPrefersDark, setSystemPrefersDark, isDark: current, setIsDark } =
        useThemeStore.getState();
      if (systemPrefersDark !== prefersDark) setSystemPrefersDark(prefersDark);
      if (current !== prefersDark) setIsDark(prefersDark);
    };

    // Apply immediately so a first-time visit is not stuck in the wrong theme.
    // The store value may be stale after a reload, so read the live preference
    // instead of trusting the persisted one.
    const unsubscribe = watchSystemPrefersDark(sync);
    sync(getSystemPrefersDark());

    return unsubscribe;
  }, [mode]);

  /** Scheduler logic — re-runs whenever mode/schedule/location changes. */
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    // 'manual' is a direct user choice and 'system' is handled by the
    // media-query listener above; neither needs a polling interval.
    if (mode === 'manual' || mode === 'system') return;

    const evaluate = async () => {
      const now = new Date();

      if (mode === 'scheduled') {
        const shouldBeDark = isDarkNow(now, startHour, endHour);
        if (shouldBeDark !== useThemeStore.getState().isDark) {
          setIsDark(shouldBeDark);
        }
        return;
      }

      if (mode === 'sunrise') {
        let lat = latitude;
        let lon = longitude;

        // Try browser geolocation if we don't have stored coords
        if (lat === null || lon === null) {
          if ('geolocation' in navigator) {
            await new Promise<void>((resolve) => {
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  lat = pos.coords.latitude;
                  lon = pos.coords.longitude;
                  useThemeStore.getState().setLocation(lat!, lon!);
                  resolve();
                },
                () => resolve(), // silently fall back
                { timeout: 5000 }
              );
            });
          }
        }

        if (lat === null || lon === null) return; // still no location

        const { sunrise, sunset } = getSunTimes(now, lat, lon);
        console.debug('[Theme] Sunrise:', sunrise.toLocaleTimeString(), '| Sunset:', sunset.toLocaleTimeString());

        const shouldBeDark = isDarkBySun(now, sunrise, sunset);
        if (shouldBeDark !== useThemeStore.getState().isDark) {
          setIsDark(shouldBeDark);
        }
      }
    };

    // Run immediately, then every 60 seconds
    evaluate();
    intervalRef.current = setInterval(evaluate, 60_000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [mode, startHour, endHour, latitude, longitude, setIsDark]);
}
