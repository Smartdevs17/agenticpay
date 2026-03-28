'use client';

import { type ReactNode } from 'react';
import { useScheduledTheme } from '@/lib/hooks/useScheduledTheme';

/**
 * Mounts the scheduled theme hook so it runs for the entire app.
 * Must be a client component wrapping the server layout.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useScheduledTheme();
  return <>{children}</>;
}
