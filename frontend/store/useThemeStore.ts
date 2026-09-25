import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  getSystemPrefersDark,
  resolveIsDark,
  type ThemePreference,
} from '@/src/lib/theme/system-preference';

export type ThemeMode = 'manual' | 'system' | 'scheduled' | 'sunrise';

export type { ThemePreference };

interface ThemeState {
  mode: ThemeMode;
  isDark: boolean;
  /** Start of dark period (0-23), used in 'scheduled' mode */
  startHour: number;
  /** End of dark period (0-23), used in 'scheduled' mode */
  endHour: number;
  /** User latitude for sunrise/sunset calculation */
  latitude: number | null;
  /** User longitude for sunrise/sunset calculation */
  longitude: number | null;
  /** Latest operating-system colour-scheme reading, used in 'system' mode */
  systemPrefersDark: boolean;

  setMode: (mode: ThemeMode) => void;
  setIsDark: (isDark: boolean) => void;
  setSchedule: (startHour: number, endHour: number) => void;
  setLocation: (latitude: number, longitude: number) => void;
  setSystemPrefersDark: (prefersDark: boolean) => void;
  /**
   * Applies a user-facing light/dark/system choice. Choosing a concrete theme
   * switches the scheduler off; `system` re-enables OS-driven detection.
   */
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
}

/** Maps the user-facing preference back onto the scheduling mode. */
function modeForPreference(preference: ThemePreference): ThemeMode {
  return preference === 'system' ? 'system' : 'manual';
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'manual',
      isDark: false,
      startHour: 20,
      endHour: 7,
      latitude: null,
      longitude: null,
      systemPrefersDark: false,

      setMode: (mode) => set({ mode }),
      setIsDark: (isDark) => set({ isDark }),
      setSchedule: (startHour, endHour) => set({ startHour, endHour }),
      setLocation: (latitude, longitude) => set({ latitude, longitude }),
      setSystemPrefersDark: (prefersDark) => set({ systemPrefersDark: prefersDark }),
      setPreference: (preference) => {
        if (preference === 'system') {
          // Read the OS straight away so the resolved value never lags a tick.
          const systemPrefersDark = getSystemPrefersDark();
          set({
            mode: 'system',
            systemPrefersDark,
            isDark: resolveIsDark('system', systemPrefersDark),
          });
          return;
        }

        set({ mode: modeForPreference(preference), isDark: resolveIsDark(preference, false) });
      },
      toggle: () => {
        // Toggling is an explicit user choice, so it opts out of any scheduler.
        set({ mode: 'manual', isDark: !get().isDark });
      },
    }),
    {
      name: 'agenticpay-theme',
      // Older persisted payloads predate `systemPrefersDark`; hydrate defaults in
      // by falling back to the store's current value rather than clobbering it.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ThemeState>;
        return {
          ...current,
          ...saved,
          systemPrefersDark: saved.systemPrefersDark ?? current.systemPrefersDark,
        };
      },
    }
  )
);

/** The preference the current mode represents, for rendering a 3-way control. */
export function getThemePreference(mode: ThemeMode, isDark: boolean): ThemePreference {
  if (mode === 'system') return 'system';
  return isDark ? 'dark' : 'light';
}
