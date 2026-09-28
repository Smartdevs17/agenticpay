import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getThemePreference, useThemeStore } from '../useThemeStore';
import { DARK_SCHEME_QUERY } from '@/src/lib/theme/system-preference';

const originalMatchMedia = window.matchMedia;

function stubSystemPrefersDark(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => ({ matches, media: DARK_SCHEME_QUERY }),
  });
}

beforeEach(() => {
  useThemeStore.setState({
    mode: 'manual',
    isDark: false,
    startHour: 20,
    endHour: 7,
    latitude: null,
    longitude: null,
    systemPrefersDark: false,
  });
  stubSystemPrefersDark(false);
});

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

describe('useThemeStore defaults', () => {
  it('starts in manual light mode', () => {
    const state = useThemeStore.getState();
    expect(state.mode).toBe('manual');
    expect(state.isDark).toBe(false);
  });

  it('keeps the scheduler settings', () => {
    expect(useThemeStore.getState().startHour).toBe(20);
    expect(useThemeStore.getState().endHour).toBe(7);
  });
});

describe('useThemeStore.toggle', () => {
  it('flips isDark', () => {
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().isDark).toBe(true);
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().isDark).toBe(false);
  });

  it('opts out of any scheduler, since it is an explicit choice', () => {
    useThemeStore.setState({ mode: 'system' });
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().mode).toBe('manual');
  });
});

describe('useThemeStore.setPreference', () => {
  it('applies light and switches to manual mode', () => {
    useThemeStore.setState({ isDark: true });
    useThemeStore.getState().setPreference('light');
    const state = useThemeStore.getState();
    expect(state.mode).toBe('manual');
    expect(state.isDark).toBe(false);
  });

  it('applies dark and switches to manual mode', () => {
    useThemeStore.getState().setPreference('dark');
    const state = useThemeStore.getState();
    expect(state.mode).toBe('manual');
    expect(state.isDark).toBe(true);
  });

  it('reads the OS preference immediately when choosing system', () => {
    stubSystemPrefersDark(true);
    useThemeStore.getState().setPreference('system');
    const state = useThemeStore.getState();
    expect(state.mode).toBe('system');
    expect(state.isDark).toBe(true);
    expect(state.systemPrefersDark).toBe(true);
  });

  it('resolves system to light when the OS prefers light', () => {
    stubSystemPrefersDark(false);
    useThemeStore.getState().setPreference('system');
    expect(useThemeStore.getState().isDark).toBe(false);
  });

  it('falls back to light when the OS preference is unavailable', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    useThemeStore.getState().setPreference('system');
    expect(useThemeStore.getState().isDark).toBe(false);
  });
});

describe('useThemeStore simple setters', () => {
  it('setMode, setIsDark, setSchedule and setLocation update their fields', () => {
    useThemeStore.getState().setMode('scheduled');
    useThemeStore.getState().setIsDark(true);
    useThemeStore.getState().setSchedule(21, 6);
    useThemeStore.getState().setLocation(48.8566, 2.3522);
    useThemeStore.getState().setSystemPrefersDark(true);

    expect(useThemeStore.getState()).toMatchObject({
      mode: 'scheduled',
      isDark: true,
      startHour: 21,
      endHour: 6,
      latitude: 48.8566,
      longitude: 2.3522,
      systemPrefersDark: true,
    });
  });
});

describe('getThemePreference', () => {
  it('reports the system preference in system mode', () => {
    expect(getThemePreference('system', false)).toBe('system');
    expect(getThemePreference('system', true)).toBe('system');
  });

  it('derives light or dark from isDark in manual mode', () => {
    expect(getThemePreference('manual', true)).toBe('dark');
    expect(getThemePreference('manual', false)).toBe('light');
  });

  it('derives from isDark for the scheduler modes', () => {
    expect(getThemePreference('scheduled', true)).toBe('dark');
    expect(getThemePreference('sunrise', false)).toBe('light');
  });
});

describe('useThemeStore persistence', () => {
  it('hydrates a legacy payload that predates systemPrefersDark', () => {
    const merge = (
      useThemeStore.persist.getOptions() as {
        merge?: (persisted: unknown, current: unknown) => unknown;
      }
    ).merge;

    expect(merge).toBeTypeOf('function');
    const merged = merge?.({ mode: 'scheduled', isDark: true }, { systemPrefersDark: false }) as {
      mode: string;
      isDark: boolean;
      systemPrefersDark: boolean;
    };

    expect(merged.mode).toBe('scheduled');
    expect(merged.isDark).toBe(true);
    expect(merged.systemPrefersDark).toBe(false);
  });

  it('preserves a persisted systemPrefersDark', () => {
    const merge = (
      useThemeStore.persist.getOptions() as {
        merge?: (persisted: unknown, current: unknown) => unknown;
      }
    ).merge;

    const merged = merge?.({ systemPrefersDark: true }, { systemPrefersDark: false }) as {
      systemPrefersDark: boolean;
    };
    expect(merged.systemPrefersDark).toBe(true);
  });

  it('tolerates a missing persisted payload', () => {
    const merge = (
      useThemeStore.persist.getOptions() as {
        merge?: (persisted: unknown, current: unknown) => unknown;
      }
    ).merge;

    const merged = merge?.(undefined, { systemPrefersDark: true }) as {
      systemPrefersDark: boolean;
    };
    expect(merged.systemPrefersDark).toBe(true);
  });
});

describe('useThemeStore persistence integration', () => {
  it('writes the preference through to localStorage', async () => {
    await useThemeStore.persist.rehydrate();
    useThemeStore.getState().setPreference('dark');
    const stored = window.localStorage.getItem('agenticpay-theme');
    expect(stored).toContain('"isDark":true');
    vi.clearAllMocks();
  });
});
