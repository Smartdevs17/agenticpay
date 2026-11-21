'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Constants (mirrors useLanguage.ts so both modules stay in sync)
// ---------------------------------------------------------------------------

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'fr', label: 'Français', dir: 'ltr' },
  { code: 'es', label: 'Español', dir: 'ltr' },
  { code: 'de', label: 'Deutsch', dir: 'ltr' },
  { code: 'pt', label: 'Português', dir: 'ltr' },
  { code: 'zh', label: '中文', dir: 'ltr' },
  { code: 'ja', label: '日本語', dir: 'ltr' },
  { code: 'ar', label: 'العربية', dir: 'rtl' },
  { code: 'hi', label: 'हिन्दी', dir: 'ltr' },
  { code: 'ko', label: '한국어', dir: 'ltr' },
] as const;

export type SupportedLocale = (typeof SUPPORTED_LANGUAGES)[number]['code'];

const DEFAULT_LOCALE: SupportedLocale = 'en';

function detectBrowserLocale(): SupportedLocale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;

  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];

  for (const lang of langs) {
    const exact = SUPPORTED_LANGUAGES.find((l) => l.code === lang);
    if (exact) return exact.code;
    const base = lang.split('-')[0];
    const baseMatch = SUPPORTED_LANGUAGES.find((l) => l.code === base);
    if (baseMatch) return baseMatch.code;
  }

  return DEFAULT_LOCALE;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface LanguageState {
  locale: SupportedLocale;
  isHydrated: boolean;

  /** Change the active locale and sync <html> attributes. */
  setLocale: (code: SupportedLocale) => void;
  /** Reset to the browser's detected locale. */
  resetToDetected: () => void;
  /** Mark the store as hydrated (called after client mount). */
  markHydrated: () => void;
}

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      locale: DEFAULT_LOCALE,
      isHydrated: false,

      setLocale: (locale) => {
        set({ locale });
        if (typeof document !== 'undefined') {
          const lang = SUPPORTED_LANGUAGES.find((l) => l.code === locale);
          document.documentElement.lang = locale;
          document.documentElement.dir = lang?.dir ?? 'ltr';
        }
      },

      resetToDetected: () => {
        const detected = detectBrowserLocale();
        set({ locale: detected });
        if (typeof document !== 'undefined') {
          const lang = SUPPORTED_LANGUAGES.find((l) => l.code === detected);
          document.documentElement.lang = detected;
          document.documentElement.dir = lang?.dir ?? 'ltr';
        }
      },

      markHydrated: () => set({ isHydrated: true }),
    }),
    {
      name: 'agenticpay-locale',
      onRehydrateStorage: () => (state) => {
        // After store rehydrates from localStorage, detect browser locale
        // if no stored preference, then mark as hydrated.
        if (state) {
          const stored = state.locale;
          const valid = SUPPORTED_LANGUAGES.some((l) => l.code === stored);
          if (!valid) {
            state.locale = detectBrowserLocale();
          }
          state.isHydrated = true;
          // Sync DOM once
          if (typeof document !== 'undefined') {
            const lang = SUPPORTED_LANGUAGES.find((l) => l.code === state.locale);
            document.documentElement.lang = state.locale;
            document.documentElement.dir = lang?.dir ?? 'ltr';
          }
        }
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectLocale = (s: LanguageState) => s.locale;
export const selectIsHydrated = (s: LanguageState) => s.isHydrated;
export const selectCurrentLanguage = (s: LanguageState) =>
  SUPPORTED_LANGUAGES.find((l) => l.code === s.locale);
