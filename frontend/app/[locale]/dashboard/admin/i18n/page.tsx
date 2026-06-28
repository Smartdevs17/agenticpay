'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import en from '@/messages/en.json';
import es from '@/messages/es.json';
import fr from '@/messages/fr.json';
import ja from '@/messages/ja.json';
import ar from '@/messages/ar.json';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { localeLabels, locales, type AppLocale } from '@/i18n/routing';

const localeMessages: Record<AppLocale, Record<string, unknown>> = {
  en,
  es,
  fr,
  ja,
  ar,
};

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

export default function TranslationManagementPage() {
  const t = useTranslations('i18nAdmin');
  const baseKeys = useMemo(() => flattenKeys(en as Record<string, unknown>), []);

  const coverage = useMemo(() => {
    return locales.map((locale) => {
      const messages = localeMessages[locale];
      const keys = flattenKeys(messages);
      const keySet = new Set(keys);
      const missing = baseKeys.filter((k) => !keySet.has(k));
      return {
        locale,
        total: baseKeys.length,
        translated: baseKeys.length - missing.length,
        missing,
        coveragePct: ((baseKeys.length - missing.length) / baseKeys.length) * 100,
      };
    });
  }, [baseKeys]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {coverage.map((row) => (
          <Card key={row.locale}>
            <CardHeader>
              <CardTitle>{localeLabels[row.locale]}</CardTitle>
              <CardDescription>
                {t('coverage')}: {row.coveragePct.toFixed(0)}%
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>{t('locale')}</span>
                <span className="font-mono">{row.locale}</span>
              </div>
              <div className="flex justify-between">
                <span>{t('missingKeys')}</span>
                <span className={row.missing.length > 0 ? 'text-amber-600 font-medium' : ''}>
                  {row.missing.length}
                </span>
              </div>
              {row.missing.length > 0 && (
                <ul className="mt-2 max-h-32 overflow-y-auto rounded border p-2 text-xs text-muted-foreground">
                  {row.missing.slice(0, 10).map((key) => (
                    <li key={key} className="font-mono">
                      {key}
                    </li>
                  ))}
                  {row.missing.length > 10 && (
                    <li>…and {row.missing.length - 10} more</li>
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
