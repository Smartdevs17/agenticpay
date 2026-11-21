/**
 * Keyboard shortcut registry and matching primitives.
 *
 * Shortcuts are declared once, as human-readable combo strings, and consumed
 * both by the runtime matcher and by the help dialog. Keeping one declaration
 * means the documented shortcuts and the working shortcuts can never drift.
 *
 * Combo grammar:
 *   step[+modifiers][+...][ step[+modifiers]... ]
 *
 * - `mod` resolves to ⌘ on Apple platforms and Ctrl elsewhere.
 * - `ctrl`, `alt`, `shift` and `meta` are matched literally.
 * - A space separates the steps of a chord (e.g. `g p` = press g, then p).
 * - Keys are compared case-insensitively against `KeyboardEvent.key`.
 */

/** Categories used to group entries in the help dialog. */
export const SHORTCUT_GROUPS = [
  'General',
  'Navigation',
  'Appearance',
] as const;

export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

export interface ShortcutStep {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  mod: boolean;
}

export interface ShortcutDefinition {
  /** Stable identifier, also used as the React key. */
  id: string;
  /** Combo string, see the grammar above. */
  combo: string;
  group: ShortcutGroup;
  description: string;
  /**
   * When true the shortcut still fires while the user is typing in an input,
   * textarea, select or contenteditable element.
   */
  allowInInput?: boolean;
}

/** The single source of truth for every global shortcut in the app. */
export const KEYBOARD_SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: 'command-palette',
    combo: 'mod+k',
    group: 'General',
    description: 'Open the command menu',
    allowInInput: true,
  },
  {
    id: 'shortcut-help',
    combo: '?',
    group: 'General',
    description: 'Show this keyboard shortcut reference',
  },
  {
    id: 'close-overlay',
    combo: 'escape',
    group: 'General',
    description: 'Close the open dialog, menu or command palette',
    allowInInput: true,
  },
  {
    id: 'toggle-theme',
    combo: 't',
    group: 'Appearance',
    description: 'Switch between light and dark mode',
  },
  {
    id: 'system-theme',
    combo: 'shift+t',
    group: 'Appearance',
    description: 'Follow the operating system colour scheme',
  },
  {
    id: 'go-dashboard',
    combo: 'g d',
    group: 'Navigation',
    description: 'Go to the dashboard home',
  },
  {
    id: 'go-projects',
    combo: 'g p',
    group: 'Navigation',
    description: 'Go to projects',
  },
  {
    id: 'go-new-project',
    combo: 'g n',
    group: 'Navigation',
    description: 'Go to the new project form',
  },
  {
    id: 'go-invoices',
    combo: 'g i',
    group: 'Navigation',
    description: 'Go to invoices',
  },
  {
    id: 'go-payments',
    combo: 'g y',
    group: 'Navigation',
    description: 'Go to payment history',
  },
  {
    id: 'go-analytics',
    combo: 'g a',
    group: 'Navigation',
    description: 'Go to analytics',
  },
] as const;

/** Routes bound to the two-key navigation chords. */
export const NAVIGATION_SHORTCUT_TARGETS: Record<string, string> = {
  'go-dashboard': '/dashboard',
  'go-projects': '/dashboard/projects',
  'go-new-project': '/dashboard/projects/new',
  'go-invoices': '/dashboard/invoices',
  'go-payments': '/dashboard/payments',
  'go-analytics': '/dashboard/analytics',
};

const MODIFIER_KEYS = new Set(['ctrl', 'control', 'meta', 'cmd', 'command', 'alt', 'option', 'shift']);

/** Parses one step of a combo into its key and modifier flags. */
function parseStep(rawStep: string): ShortcutStep {
  const parts = rawStep
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  const step: ShortcutStep = {
    key: '',
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    mod: false,
  };

  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') step.ctrl = true;
    else if (part === 'meta' || part === 'cmd' || part === 'command') step.meta = true;
    else if (part === 'alt' || part === 'option') step.alt = true;
    else if (part === 'shift') step.shift = true;
    else if (part === 'mod') step.mod = true;
    else if (!MODIFIER_KEYS.has(part)) step.key = part;
  }

  return step;
}

/** Splits a combo into its ordered chord steps. */
export function parseCombo(combo: string): ShortcutStep[] {
  return (
    combo
      // Whitespace hugging a `+` is cosmetic, so collapse it before splitting
      // into steps; whatever whitespace is left separates chord steps.
      .replace(/\s*\+\s*/g, '+')
      .split(/\s+/)
      .filter(Boolean)
      .map(parseStep)
  );
}

/** True when the platform uses ⌘ as its primary modifier. */
export function detectIsMac(userAgent?: string): boolean {
  const ua =
    userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent || '');
  return /mac|iphone|ipad|ipod/i.test(ua);
}

/** Normalises an event key so combos can be written in lowercase. */
function normalizeKey(key: string): string {
  if (key === ' ') return 'space';
  if (key === 'Esc') return 'escape';
  return key.toLowerCase();
}

/** True when the event target is a field the user is typing into. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as Partial<HTMLElement> & { tagName?: string };
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** True when a shortcut should be ignored because the user is typing. */
export function shouldIgnoreShortcut(
  event: Pick<KeyboardEvent, 'target'>,
  allowInInput?: boolean
): boolean {
  if (allowInInput) return false;
  return isEditableTarget(event.target);
}

/** Matches a single keypress against one chord step. */
export function matchesStep(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  step: ShortcutStep,
  isMac = false
): boolean {
  if (normalizeKey(event.key) !== step.key) return false;

  const wantsCtrl = step.ctrl || (step.mod && !isMac);
  const wantsMeta = step.meta || (step.mod && isMac);
  if (event.ctrlKey !== wantsCtrl) return false;
  if (event.metaKey !== wantsMeta) return false;
  if (event.altKey !== step.alt) return false;

  // Punctuation such as `?` is only reachable with Shift held, so requiring
  // `shiftKey === false` for those keys would make them unmatchable on every
  // layout. Shift is only constrained for steps that name it explicitly.
  const isPunctuation = step.key.length === 1 && !/[a-z0-9]/.test(step.key);
  if (!isPunctuation && event.shiftKey !== step.shift) return false;

  return true;
}

/** Matches a keypress against a full chord, requiring the first step too. */
export function matchesCombo(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'target'>,
  definition: Pick<ShortcutDefinition, 'combo' | 'allowInInput'>,
  isMac = false
): boolean {
  if (shouldIgnoreShortcut(event, definition.allowInInput)) return false;

  const steps = parseCombo(definition.combo);
  if (steps.length === 0) return false;

  // For a single-step combo this is just a direct comparison; for a chord the
  // first step was already consumed earlier, so only the final step is checked.
  const lastStep = steps[steps.length - 1];
  return matchesStep(event, lastStep, isMac);
}

const KEY_LABELS: Record<string, string> = {
  escape: 'Esc',
  enter: 'Enter',
  ' ': 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

/** Renders a combo as individual key caps, e.g. `mod+k` on macOS → `['⌘', 'K']`. */
export function formatCombo(combo: string, isMac = false): string[] {
  return parseCombo(combo).map((step) => {
    const caps: string[] = [];
    if (step.mod) caps.push(isMac ? '⌘' : 'Ctrl');
    if (step.ctrl) caps.push('Ctrl');
    if (step.meta) caps.push('⌘');
    if (step.alt) caps.push(isMac ? '⌥' : 'Alt');
    if (step.shift) caps.push('⇧');
    caps.push(KEY_LABELS[step.key] ?? step.key.toUpperCase());
    return caps.join(isMac ? '' : '+');
  });
}
