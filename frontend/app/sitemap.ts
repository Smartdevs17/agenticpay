import type { MetadataRoute } from 'next/server';
import { locales, defaultLocale } from '@/i18n/routing';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://agenticpay.com';

const PUBLIC_PATHS = ['', '/auth', '/dashboard', '/dashboard/monitoring/bridges'];

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const path of PUBLIC_PATHS) {
    const languages: Record<string, string> = {};
    for (const locale of locales) {
      languages[locale] =
        locale === defaultLocale ? `${BASE_URL}${path}` : `${BASE_URL}/${locale}${path}`;
    }

    entries.push({
      url: `${BASE_URL}${path}`,
      lastModified: new Date(),
      changeFrequency: path === '' ? 'weekly' : 'daily',
      priority: path === '' ? 1 : 0.7,
      alternates: { languages },
    });
  }

  return entries;
}
