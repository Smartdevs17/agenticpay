'use client';

import { useEffect } from 'react';
import {
  useLanguageStore,
  SUPPORTED_LANGUAGES,
  type SupportedLocale,
} from '@/store/useLanguageStore';

/**
 * LanguageProvider
 *
 * Thin initialisation component — no longer uses React Context.
 * State lives in the Zustand `useLanguageStore` so any component can
 * subscribe with a selector without re-renders on unrelated state changes.
 *
 * On first client mount it detects the browser locale (or reads the stored
 * preference from localStorage) and marks the store as hydrated.
 */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const markHydrated = useLanguageStore((s) => s.markHydrated);
  const isHydrated = useLanguageStore((s) => s.isHydrated);

  useEffect(() => {
    if (!isHydrated) {
      markHydrated();
    }
  }, [isHydrated, markHydrated]);

  return <>{children}</>;
}

/**
 * useLocale
 *
 * Drop-in replacement for the previous Context-based hook.
 * Components that previously called `useLocale()` continue to work unchanged.
 */
export function useLocale() {
  const locale = useLanguageStore((s) => s.locale);
  const setLocale = useLanguageStore((s) => s.setLocale);
  const resetToDetected = useLanguageStore((s) => s.resetToDetected);
  const isHydrated = useLanguageStore((s) => s.isHydrated);

  const currentLanguage = SUPPORTED_LANGUAGES.find((l) => l.code === locale);

  return {
    locale,
    setLocale,
    resetToDetected,
    supportedLanguages: SUPPORTED_LANGUAGES,
    currentLanguage,
    isHydrated,
  };
}

// Re-export type so consumers don't need to import from two places
export type { SupportedLocale };
