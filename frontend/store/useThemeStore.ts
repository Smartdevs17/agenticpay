import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'manual' | 'scheduled' | 'sunrise';

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

  setMode: (mode: ThemeMode) => void;
  setIsDark: (isDark: boolean) => void;
  setSchedule: (startHour: number, endHour: number) => void;
  setLocation: (latitude: number, longitude: number) => void;
  toggle: () => void;
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

      setMode: (mode) => set({ mode }),
      setIsDark: (isDark) => set({ isDark }),
      setSchedule: (startHour, endHour) => set({ startHour, endHour }),
      setLocation: (latitude, longitude) => set({ latitude, longitude }),
      toggle: () => set({ isDark: !get().isDark }),
    }),
    {
      name: 'agenticpay-theme',
    }
  )
);
