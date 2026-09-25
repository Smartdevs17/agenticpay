'use client';

import { useCallback } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useThemeStore } from '@/store/useThemeStore';
import { useCommandStore } from '@/store/useCommandStore';
import { useShortcutsStore } from '@/store/useShortcutsStore';
import { useKeyboardShortcuts } from '@/src/hooks/use-keyboard-shortcuts';
import {
  KEYBOARD_SHORTCUTS,
  NAVIGATION_SHORTCUT_TARGETS,
} from '@/src/lib/keyboard-shortcuts';
import { KeyboardShortcutsDialog } from '@/src/components/keyboard-shortcuts-dialog';

/**
 * Owns every global keyboard shortcut: the command palette, the shortcut
 * reference, theme switching and the two-key navigation chords.
 *
 * Mounted once inside the app providers so the bindings are identical on every
 * route and locale.
 */
export function KeyboardShortcutsProvider() {
  const router = useRouter();
  const { isHelpOpen, toggle: toggleHelp, close: closeHelp } = useShortcutsStore();
  const closeCommandMenu = useCommandStore((state) => state.close);
  const setPreference = useThemeStore((state) => state.setPreference);
  const toggleTheme = useThemeStore((state) => state.toggle);

  const handleTrigger = useCallback(
    (id: string) => {
      const target = NAVIGATION_SHORTCUT_TARGETS[id];
      if (target) {
        router.push(target);
        return;
      }

      switch (id) {
        case 'command-palette':
          // Reuse the store so the shortcut and the toolbar button can never
          // disagree about whether the palette is open.
          useCommandStore.getState().toggle();
          return;
        case 'shortcut-help':
          toggleHelp();
          return;
        case 'close-overlay':
          closeCommandMenu();
          closeHelp();
          return;
        case 'toggle-theme':
          toggleTheme();
          return;
        case 'system-theme':
          setPreference('system');
          return;
        default:
          return;
      }
    },
    [closeCommandMenu, closeHelp, router, setPreference, toggleHelp, toggleTheme]
  );

  useKeyboardShortcuts({ shortcuts: KEYBOARD_SHORTCUTS, onTrigger: handleTrigger });

  return <KeyboardShortcutsDialog open={isHelpOpen} onOpenChange={toggleHelp} />;
}
