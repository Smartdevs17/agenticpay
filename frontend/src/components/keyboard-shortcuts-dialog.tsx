'use client';

import { Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  KEYBOARD_SHORTCUTS,
  SHORTCUT_GROUPS,
  detectIsMac,
  formatCombo,
  type ShortcutGroup,
} from '@/src/lib/keyboard-shortcuts';

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ShortcutKeys({ combo, isMac }: { combo: string; isMac: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {formatCombo(combo, isMac).map((cap) => (
        <kbd
          key={cap}
          className="pointer-events-none inline-flex h-6 min-w-6 select-none items-center justify-center rounded border border-gray-200 bg-gray-50 px-1.5 font-mono text-[11px] font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          {cap}
        </kbd>
      ))}
    </span>
  );
}

/**
 * Read-only reference for every shortcut in
 * {@link KEYBOARD_SHORTCUTS}, grouped by category.
 */
export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  const isMac = detectIsMac();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" data-testid="keyboard-shortcuts-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Speed up common actions without leaving the keyboard. Press{' '}
            <ShortcutKeys combo="?" isMac={isMac} /> anywhere to reopen this list.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto py-1">
          {SHORTCUT_GROUPS.map((group: ShortcutGroup) => {
            const entries = KEYBOARD_SHORTCUTS.filter((shortcut) => shortcut.group === group);
            if (entries.length === 0) return null;

            return (
              <section key={group} data-testid={`shortcut-group-${group.toLowerCase()}`}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </h3>
                <ul className="space-y-1.5">
                  {entries.map((shortcut) => (
                    <li
                      key={shortcut.id}
                      className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2"
                    >
                      <span className="text-sm">{shortcut.description}</span>
                      <ShortcutKeys combo={shortcut.combo} isMac={isMac} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Toolbar affordance that opens {@link KeyboardShortcutsDialog}. */
export function KeyboardShortcutsButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="gap-2"
      data-testid="keyboard-shortcuts-button"
    >
      <Keyboard className="h-4 w-4" />
      <span className="hidden sm:inline">Shortcuts</span>
    </Button>
  );
}

export default KeyboardShortcutsDialog;
