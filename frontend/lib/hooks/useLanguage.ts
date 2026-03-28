'use client';

import { useState, useEffect, useCallback } from 'react';
import { unstable_batchedUpdates } from 'react-dom';

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

const STORAGE_KEY = 'agenticpay-locale';
const DEFAULT_LOCALE: SupportedLocale = 'en';

function detectBrowserLocale(): SupportedLocale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
 
  const browserLanguages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
 
  for (const lang of browserLanguages) {
    // Exact match
    const exact = SUPPORTED_LANGUAGES.find((l) => l.code === lang);
    if (exact) return exact.code;
 
    // Base language match (e.g. "fr-CA" → "fr")
    const base = lang.split('-')[0];
    const baseMatch = SUPPORTED_LANGUAGES.find((l) => l.code === base);
    if (baseMatch) return baseMatch.code;
  }
 
  return DEFAULT_LOCALE;
}

export function useLanguage() {
    const [locale, setLocaleState] = useState<SupportedLocale>(DEFAULT_LOCALE);
  const [isHydrated, setIsHydrated] = useState(false);
 
  useEffect(() => {
    // On mount: check for stored manual override, otherwise detect from browser
    const stored = localStorage.getItem(STORAGE_KEY) as SupportedLocale | null;
    const resolved =
      stored && SUPPORTED_LANGUAGES.some((l) => l.code === stored)
        ? stored
        : detectBrowserLocale();
 
    // Batch state updates to prevent cascading renders
    unstable_batchedUpdates(() => {
      setLocaleState(resolved);
      setIsHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    // Sync <html> attributes whenever locale changes
    const lang = SUPPORTED_LANGUAGES.find((l) => l.code === locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = lang?.dir ?? 'ltr';
  }, [locale, isHydrated]);

  const setLocale = useCallback((code: SupportedLocale) => {
    localStorage.setItem(STORAGE_KEY, code);
    setLocaleState(code);
  }, []);

  const resetToDetected = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setLocaleState(detectBrowserLocale());
  }, []);

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