'use client';

import { useMemo } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getThemePreference, useThemeStore } from '@/store/useThemeStore';
import type { ThemePreference } from '@/src/lib/theme/system-preference';

const OPTIONS: {
  value: ThemePreference;
  label: string;
  hint: string;
  icon: typeof Sun;
}[] = [
  { value: 'light', label: 'Light', hint: 'Always use the light theme', icon: Sun },
  { value: 'dark', label: 'Dark', hint: 'Always use the dark theme', icon: Moon },
  {
    value: 'system',
    label: 'System',
    hint: 'Match your operating system setting',
    icon: Monitor,
  },
];

export interface ThemeToggleProps {
  className?: string;
}

/**
 * Three-way light / dark / system theme control.
 *
 * The resolved `dark` class on <html> is owned exclusively by
 * `useScheduledTheme`, so this component only ever writes to the store.
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const mode = useThemeStore((state) => state.mode);
  const isDark = useThemeStore((state) => state.isDark);
  const systemPrefersDark = useThemeStore((state) => state.systemPrefersDark);
  const setPreference = useThemeStore((state) => state.setPreference);

  const preference = useMemo(() => getThemePreference(mode, isDark), [mode, isDark]);

  const label = useMemo(() => {
    const active = OPTIONS.find((option) => option.value === preference);
    return `Theme: ${active?.label ?? 'Light'}`;
  }, [preference]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`relative flex h-9 w-9 ${className ?? ''}`}
          title={label}
          aria-label={label}
          data-testid="theme-toggle"
        >
          {isDark ? (
            <Moon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          ) : (
            <Sun className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          )}
          {preference === 'system' && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-primary">
              <Monitor className="h-2 w-2 text-primary-foreground" />
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" data-testid="theme-toggle-menu">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => setPreference(value as ThemePreference)}
        >
          {OPTIONS.map(({ value, label: optionLabel, hint, icon: Icon }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              className="flex-col items-start gap-0.5"
              data-testid={`theme-option-${value}`}
            >
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {optionLabel}
              </span>
              <span className="text-xs text-muted-foreground">
                {value === 'system' && systemPrefersDark
                  ? `${hint} (currently dark)`
                  : value === 'system' && !systemPrefersDark
                    ? `${hint} (currently light)`
                    : hint}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ThemeToggle;
