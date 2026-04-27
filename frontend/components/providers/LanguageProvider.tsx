'use client';

import { useLanguage } from '@/lib/hooks/useLanguage';
import { createContext, useContext } from 'react';

type LanguageContextValue = ReturnType<typeof useLanguage>;

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * Provides language detection, locale state, and manual override
 * to the entire application. Wrap this around children in the root layout.
 */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const language = useLanguage();
  return (
    <LanguageContext.Provider value={language}>
      {children}
    </LanguageContext.Provider>
  );
}

/**
 * Consume the current locale and language utilities anywhere in the tree.
 */
export function useLocale() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLocale must be used inside <LanguageProvider>');
  }
  return ctx;
}