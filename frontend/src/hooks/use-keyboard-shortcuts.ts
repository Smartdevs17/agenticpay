'use client';

import { useEffect, useRef } from 'react';
import {
  detectIsMac,
  matchesStep,
  parseCombo,
  shouldIgnoreShortcut,
  type ShortcutDefinition,
} from '@/src/lib/keyboard-shortcuts';

/** Milliseconds allowed between the steps of a two-key chord such as `g p`. */
export const CHORD_TIMEOUT_MS = 1200;

export interface UseKeyboardShortcutsOptions {
  shortcuts: readonly ShortcutDefinition[];
  /** Invoked with the shortcut id when it fires. */
  onTrigger: (id: string) => void;
  /** Disables the listener entirely, e.g. while a modal owns the keyboard. */
  enabled?: boolean;
  /** Injectable for tests. */
  isMac?: boolean;
}

/**
 * Binds global keyboard shortcuts to `onTrigger`.
 *
 * Two-key chords are supported: a leading step that starts a chord (such as
 * `g`) arms the shortcut, and a second step within {@link CHORD_TIMEOUT_MS}
 * completes it. Pressing a non-chord key, or letting the timeout lapse,
 * disarms the pending chord.
 */
export function useKeyboardShortcuts({
  shortcuts,
  onTrigger,
  enabled = true,
  isMac,
}: UseKeyboardShortcutsOptions) {
  const onTriggerRef = useRef(onTrigger);
  const pendingStepRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onTriggerRef.current = onTrigger;
  }, [onTrigger]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === 'undefined') return;

    const platformIsMac = isMac ?? detectIsMac();

    const clearPending = () => {
      pendingStepRef.current = null;
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // 1. Try to complete an armed chord against every registered shortcut.
      if (pendingStepRef.current) {
        const armed = pendingStepRef.current;
        for (const shortcut of shortcuts) {
          const steps = parseCombo(shortcut.combo);
          if (steps.length < 2 || steps[0].key !== armed) continue;
          if (shouldIgnoreShortcut(event, shortcut.allowInInput)) continue;
          if (!matchesStep(event, steps[steps.length - 1], platformIsMac)) continue;

          event.preventDefault();
          clearPending();
          onTriggerRef.current(shortcut.id);
          return;
        }
      }

      // 2. Otherwise look for a new match or a new chord to arm.
      let armedKey: string | null = null;

      for (const shortcut of shortcuts) {
        if (shouldIgnoreShortcut(event, shortcut.allowInInput)) continue;

        const steps = parseCombo(shortcut.combo);
        if (steps.length === 0) continue;

        if (steps.length > 1) {
          if (matchesStep(event, steps[0], platformIsMac)) {
            armedKey = steps[0].key;
            break;
          }
          continue;
        }

        if (matchesStep(event, steps[0], platformIsMac)) {
          event.preventDefault();
          clearPending();
          onTriggerRef.current(shortcut.id);
          return;
        }
      }

      if (armedKey) {
        clearPending();
        pendingStepRef.current = armedKey;
        pendingTimerRef.current = setTimeout(clearPending, CHORD_TIMEOUT_MS);
        return;
      }

      clearPending();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  }, [enabled, isMac, shortcuts]);
}
