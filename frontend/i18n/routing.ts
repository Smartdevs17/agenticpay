import { defineRouting } from 'next-intl/routing';

export const locales = ['en', 'es', 'fr', 'ja', 'ar'] as const;
export type AppLocale = (typeof locales)[number];

export const defaultLocale: AppLocale = 'en';

export const localeLabels: Record<AppLocale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  ja: '日本語',
  ar: 'العربية',
};

export const rtlLocales: AppLocale[] = ['ar'];

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'as-needed',
});
