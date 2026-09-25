import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KEYBOARD_SHORTCUTS,
  NAVIGATION_SHORTCUT_TARGETS,
  detectIsMac,
  formatCombo,
  isEditableTarget,
  matchesCombo,
  matchesStep,
  parseCombo,
  shouldIgnoreShortcut,
  type ShortcutDefinition,
} from '../keyboard-shortcuts';

type KeyEvent = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'target'
>;

function press(
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>> = {},
  target: EventTarget | null = null
): KeyEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target,
    ...modifiers,
  };
}

const find = (id: string): ShortcutDefinition => {
  const found = KEYBOARD_SHORTCUTS.find((shortcut) => shortcut.id === id);
  if (!found) throw new Error(`missing shortcut: ${id}`);
  return found;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseCombo', () => {
  it('parses a single key', () => {
    expect(parseCombo('t')).toEqual([
      { key: 't', ctrl: false, meta: false, alt: false, shift: false, mod: false },
    ]);
  });

  it('parses modifiers', () => {
    const [step] = parseCombo('shift+alt+t');
    expect(step).toEqual({
      key: 't',
      ctrl: false,
      meta: false,
      alt: true,
      shift: true,
      mod: false,
    });
  });

  it('treats ctrl as a modifier, not a key', () => {
    const [step] = parseCombo('ctrl+enter');
    expect(step.key).toBe('enter');
    expect(step.ctrl).toBe(true);
  });

  it('accepts aliases for mod', () => {
    for (const alias of ['mod', 'cmd', 'command', 'meta']) {
      expect(parseCombo(`${alias}+k`)[0]).toMatchObject({ mod: alias === 'mod', meta: alias !== 'mod' });
    }
  });

  it('splits a chord into ordered steps', () => {
    expect(parseCombo('g p').map((step) => step.key)).toEqual(['g', 'p']);
  });

  it('ignores surrounding whitespace', () => {
    expect(parseCombo('  mod + k ').map((step) => step.key)).toEqual(['k']);
    expect(parseCombo('   ')).toEqual([]);
  });

  it('lower-cases the key so combos can be written in any case', () => {
    expect(parseCombo('Escape')[0].key).toBe('escape');
  });
});

describe('detectIsMac', () => {
  it('detects macOS user agents', () => {
    expect(detectIsMac('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(true);
    expect(detectIsMac('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
  });

  it('detects non-Apple user agents', () => {
    expect(detectIsMac('Mozilla/5.0 (X11; Linux x86_64)')).toBe(false);
    expect(detectIsMac('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
  });

  it('reads navigator.userAgent when no argument is given', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X)');
    expect(detectIsMac()).toBe(true);
  });
});

describe('isEditableTarget', () => {
  it('recognises form fields', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isEditableTarget(document.createElement(tag))).toBe(true);
    }
  });

  it('recognises contenteditable elements', () => {
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isEditableTarget(div)).toBe(true);
  });

  it('ignores other elements and null', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('shouldIgnoreShortcut', () => {
  const input = () => document.createElement('input');

  it('ignores ordinary shortcuts while typing', () => {
    expect(shouldIgnoreShortcut(press('t', {}, input()))).toBe(true);
  });

  it('allows shortcuts flagged with allowInInput', () => {
    expect(shouldIgnoreShortcut(press('k', {}, input()), true)).toBe(false);
  });
});

describe('matchesStep', () => {
  it('matches a bare key', () => {
    expect(matchesStep(press('t'), parseCombo('t')[0])).toBe(true);
    expect(matchesStep(press('x'), parseCombo('t')[0])).toBe(false);
  });

  it('normalises event key case', () => {
    expect(matchesStep(press('T', { shiftKey: true }), parseCombo('shift+t')[0])).toBe(true);
  });

  it('maps mod to Meta on Apple platforms', () => {
    const step = parseCombo('mod+k')[0];
    expect(matchesStep(press('k', { metaKey: true }), step, true)).toBe(true);
    expect(matchesStep(press('k', { ctrlKey: true }), step, true)).toBe(false);
  });

  it('maps mod to Control elsewhere', () => {
    const step = parseCombo('mod+k')[0];
    expect(matchesStep(press('k', { ctrlKey: true }), step, false)).toBe(true);
    expect(matchesStep(press('k', { metaKey: true }), step, false)).toBe(false);
  });

  it('requires the declared modifiers to be absent otherwise', () => {
    expect(matchesStep(press('t', { ctrlKey: true }), parseCombo('t')[0])).toBe(false);
  });
});

describe('matchesCombo', () => {
  it('matches ⌘K on macOS and Ctrl+K elsewhere', () => {
    const combo = find('command-palette');
    expect(matchesCombo(press('k', { metaKey: true }), combo, true)).toBe(true);
    expect(matchesCombo(press('k', { ctrlKey: true }), combo, false)).toBe(true);
    expect(matchesCombo(press('k'), combo, false)).toBe(false);
  });

  it('matches the bare help key', () => {
    expect(matchesCombo(press('?'), find('shortcut-help'))).toBe(true);
    expect(matchesCombo(press('/'), find('shortcut-help'))).toBe(false);
  });

  it('matches Escape', () => {
    expect(matchesCombo(press('Escape'), find('close-overlay'))).toBe(true);
  });

  it('checks the final step of a chord', () => {
    expect(matchesCombo(press('p'), find('go-projects'))).toBe(true);
    expect(matchesCombo(press('z'), find('go-projects'))).toBe(false);
  });

  it('is suppressed while typing unless allowInInput is set', () => {
    const input = document.createElement('input');
    expect(matchesCombo(press('t', {}, input), find('toggle-theme'))).toBe(false);
    expect(matchesCombo(press('k', { ctrlKey: true }, input), find('command-palette'))).toBe(true);
  });

  it('returns false for an empty combo', () => {
    expect(matchesCombo(press('t'), { combo: '   ' })).toBe(false);
  });
});

describe('formatCombo', () => {
  it('renders the Apple modifier glyphs', () => {
    expect(formatCombo('mod+k', true)).toEqual(['⌘K']);
    expect(formatCombo('shift+t', true)).toEqual(['⇧T']);
    expect(formatCombo('alt+k', true)).toEqual(['⌥K']);
  });

  it('renders word modifiers elsewhere', () => {
    expect(formatCombo('mod+k', false)).toEqual(['Ctrl+K']);
    expect(formatCombo('alt+k', false)).toEqual(['Alt+K']);
  });

  it('renders one entry per chord step', () => {
    expect(formatCombo('g p', false)).toEqual(['G', 'P']);
  });

  it('renames special keys', () => {
    expect(formatCombo('escape', false)).toEqual(['Esc']);
  });
});

describe('the shortcut registry', () => {
  it('has unique ids', () => {
    const ids = KEYBOARD_SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('parses every declared combo', () => {
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      const steps = parseCombo(shortcut.combo);
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) expect(step.key).not.toBe('');
    }
  });

  it('resolves every navigation shortcut to a route', () => {
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      const isNavigation = shortcut.group === 'Navigation';
      expect(Boolean(NAVIGATION_SHORTCUT_TARGETS[shortcut.id])).toBe(isNavigation);
    }
  });

  it('declares a description and group for each shortcut', () => {
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      expect(shortcut.description.length).toBeGreaterThan(0);
      expect(['General', 'Navigation', 'Appearance']).toContain(shortcut.group);
    }
  });
});
