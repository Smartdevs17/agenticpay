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
import { useLocale } from '@/components/providers/LanguageProvider';
import { SupportedLocale } from '@/lib/hooks/useLanguage';

interface LanguageSwitcherProps {
  /** Render just the globe icon (compact mode for headers/sidebars) */
  compact?: boolean;
}

export function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const { locale, setLocale, resetToDetected, supportedLanguages, currentLanguage } =
    useLocale();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={compact ? 'icon' : 'sm'} aria-label="Change Language">
          <Globe className="h-4 w-4" />
          {!compact && (
            <span className="ml-1 text-sm">{currentLanguage?.label ?? locale}</span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          Change Language
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {supportedLanguages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => setLocale(lang.code as SupportedLocale)}
            className="flex items-center justify-between"
          >
            <span>{lang.label}</span>
            {lang.code === locale && (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={resetToDetected}
          className="text-xs text-muted-foreground"
        >
          Reset to Browser Default
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}