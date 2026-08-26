'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Globe } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { localeLabels, locales, type AppLocale } from '@/i18n/routing';

interface LocaleSwitcherProps {
  compact?: boolean;
}

export function LocaleSwitcher({ compact = false }: LocaleSwitcherProps) {
  const t = useTranslations('language');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const pathname = usePathname();

  const switchLocale = (nextLocale: AppLocale) => {
    router.replace(pathname, { locale: nextLocale });
  };

  const resetToBrowser = () => {
    if (typeof navigator === 'undefined') return;
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const lang of langs) {
      const base = lang.split('-')[0] as AppLocale;
      if (locales.includes(base)) {
        switchLocale(base);
        return;
      }
    }
    switchLocale('en');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={compact ? 'icon' : 'sm'} aria-label={t('changeLanguage')}>
          <Globe className="h-4 w-4" />
          {!compact && <span className="ms-1 text-sm">{localeLabels[locale] ?? locale}</span>}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          {t('changeLanguage')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {locales.map((code) => (
          <DropdownMenuItem
            key={code}
            onClick={() => switchLocale(code)}
            className="flex items-center justify-between"
          >
            <span>{localeLabels[code]}</span>
            {code === locale && <span className="ms-auto h-1.5 w-1.5 rounded-full bg-primary" />}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={resetToBrowser} className="text-xs text-muted-foreground">
          {t('resetToBrowser')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
