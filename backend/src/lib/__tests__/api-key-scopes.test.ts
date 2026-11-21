import { describe, it, expect } from 'vitest';
import {
  ALL_SCOPES,
  DEFAULT_SCOPES,
  GRANULAR_SCOPES,
  SCOPE_ACTIONS,
  SCOPE_RESOURCES,
  hasScope,
  hasAllScopes,
  isValidScope,
  missingScopes,
  validateScopes,
} from '../api-key-scopes.js';

describe('scope vocabulary', () => {
  it('exposes every resource/action combination as a granular scope', () => {
    const expected = SCOPE_RESOURCES.length * SCOPE_ACTIONS.length;
    expect(GRANULAR_SCOPES).toHaveLength(expected);
    expect(GRANULAR_SCOPES).toContain('payments:read');
    expect(GRANULAR_SCOPES).toContain('batch:write');
  });

  it('offers the broad legacy scopes alongside the granular ones', () => {
    expect(ALL_SCOPES).toContain('*');
    expect(ALL_SCOPES).toContain('read');
    expect(ALL_SCOPES).toContain('write');
  });

  it('has no duplicate entries', () => {
    expect(new Set(ALL_SCOPES).size).toBe(ALL_SCOPES.length);
  });

  it('defaults new keys to the broad scope', () => {
    expect(DEFAULT_SCOPES).toEqual(['*']);
  });
});

describe('isValidScope', () => {
  it('accepts granular and broad scopes', () => {
    expect(isValidScope('payments:read')).toBe(true);
    expect(isValidScope('*')).toBe(true);
    expect(isValidScope('read')).toBe(true);
  });

  it('rejects an unknown resource', () => {
    expect(isValidScope('payments:delete')).toBe(false);
    expect(isValidScope('secrets:read')).toBe(false);
  });

  it('rejects wildcards beyond the single universal scope', () => {
    expect(isValidScope('payments:*')).toBe(false);
    expect(isValidScope('*:read')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidScope(undefined)).toBe(false);
    expect(isValidScope(42)).toBe(false);
    expect(isValidScope(['payments:read'])).toBe(false);
  });
});

describe('validateScopes', () => {
  it('falls back to the default when nothing is supplied', () => {
    expect(validateScopes(undefined)).toEqual(['*']);
    expect(validateScopes(null)).toEqual(['*']);
  });

  it('accepts an empty list as an explicit no-permissions key', () => {
    expect(validateScopes([])).toEqual([]);
  });

  it('preserves the order the caller supplied', () => {
    expect(validateScopes(['batch:write', 'payments:read'])).toEqual(['batch:write', 'payments:read']);
  });

  it('de-duplicates repeated scopes', () => {
    expect(validateScopes(['payments:read', 'payments:read'])).toEqual(['payments:read']);
  });

  it('rejects a non-array', () => {
    expect(() => validateScopes('payments:read')).toThrow(/must be an array/);
  });

  it('names the offending scope and lists the valid ones', () => {
    expect(() => validateScopes(['payments:read', 'payments:delete'])).toThrow(
      /Unknown API key scope: payments:delete/
    );
    expect(() => validateScopes(['payments:delete'])).toThrow(/Valid scopes:/);
  });
});

describe('hasScope', () => {
  it('grants a directly held scope', () => {
    expect(hasScope(['payments:write'], 'payments:write')).toBe(true);
  });

  it('denies a scope that is not held', () => {
    expect(hasScope(['payments:read'], 'payments:write')).toBe(false);
  });

  it('lets * satisfy any requirement', () => {
    expect(hasScope(['*'], 'payments:write')).toBe(true);
    expect(hasScope(['*'], 'analytics:read')).toBe(true);
  });

  it('treats a broad action as covering that action on every resource', () => {
    expect(hasScope(['read'], 'payments:read')).toBe(true);
    expect(hasScope(['read'], 'analytics:read')).toBe(true);
    expect(hasScope(['read'], 'payments:write')).toBe(false);
  });

  it('keeps resources isolated from one another', () => {
    expect(hasScope(['payments:read'], 'invoices:read')).toBe(false);
  });

  it('denies everything when no scopes are recorded', () => {
    expect(hasScope([], 'payments:read')).toBe(false);
    expect(hasScope(null, 'payments:read')).toBe(false);
    expect(hasScope(undefined, 'payments:read')).toBe(false);
  });
});

describe('missingScopes and hasAllScopes', () => {
  it('reports only the scopes that are not held', () => {
    expect(missingScopes(['payments:read'], ['payments:read', 'payments:write'])).toEqual([
      'payments:write',
    ]);
  });

  it('reports nothing when every scope is held', () => {
    expect(missingScopes(['*'], ['payments:write', 'analytics:read'])).toEqual([]);
  });

  it('requires all scopes to be satisfied together', () => {
    expect(hasAllScopes(['payments:read'], ['payments:read'])).toBe(true);
    expect(hasAllScopes(['payments:read'], ['payments:read', 'payments:write'])).toBe(false);
  });

  it('treats a read-only key as unable to write', () => {
    const readOnly = ['payments:read', 'invoices:read', 'analytics:read'];
    expect(hasAllScopes(readOnly, ['payments:read'])).toBe(true);
    expect(hasAllScopes(readOnly, ['payments:write'])).toBe(false);
  });
});
