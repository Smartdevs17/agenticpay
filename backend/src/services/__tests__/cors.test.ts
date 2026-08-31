/**
 * cors.test.ts — Unit tests for the dynamic CORS origin whitelist service.
 *
 * Covers validation, pattern matching (exact / subdomain wildcard /
 * scheme-relative / open), the runtime-mutable policy, async loader refresh,
 * and shared metrics.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CorsPolicyError,
  CORSOriginPolicy,
  addAllowedOrigin,
  getAllowedOrigins,
  getCorsMetrics,
  getCorsPolicy,
  initCorsPolicy,
  isOriginAllowed,
  isValidOrigin,
  isValidPattern,
  originMatches,
  recordPreflight,
  refreshAllowedOrigins,
  removeAllowedOrigin,
  resetCorsMetrics,
  setAllowedOrigins,
} from '../cors.js';

describe('isValidOrigin', () => {
  it('accepts well-formed origins', () => {
    expect(isValidOrigin('https://app.example.com')).toBe(true);
    expect(isValidOrigin('https://app.example.com:8443')).toBe(true);
    expect(isValidOrigin('http://localhost:5173')).toBe(true);
    expect(isValidOrigin('HTTPS://APP.EXAMPLE.COM')).toBe(true);
    expect(isValidOrigin('ws://socket.example.com')).toBe(true);
  });

  it('rejects origins with paths, queries, or fragments', () => {
    expect(isValidOrigin('https://app.example.com/')).toBe(false);
    expect(isValidOrigin('https://app.example.com/path')).toBe(false);
    expect(isValidOrigin('https://app.example.com?q=1')).toBe(false);
    expect(isValidOrigin('https://app.example.com#frag')).toBe(false);
  });

  it('rejects missing schemes, whitespace, and control characters', () => {
    expect(isValidOrigin('app.example.com')).toBe(false);
    expect(isValidOrigin('https://')).toBe(false);
    expect(isValidOrigin('https://:80')).toBe(false);
    expect(isValidOrigin('https://app example.com')).toBe(false);
    expect(isValidOrigin('https://app.example.com\n')).toBe(false);
    expect(isValidOrigin('https:/\u0000app.example.com')).toBe(false);
  });

  it('rejects null, empty, and oversized origins', () => {
    expect(isValidOrigin('null')).toBe(false);
    expect(isValidOrigin('')).toBe(false);
    expect(isValidOrigin('https://' + 'a'.repeat(300) + '.com')).toBe(false);
  });
});

describe('isValidPattern', () => {
  it('accepts exact origins and wildcard patterns', () => {
    expect(isValidPattern('https://app.example.com')).toBe(true);
    expect(isValidPattern('https://*.example.com')).toBe(true);
    expect(isValidPattern('https://*.app.example.com')).toBe(true);
    expect(isValidPattern('*.example.com')).toBe(true);
    expect(isValidPattern('example.com')).toBe(true);
    expect(isValidPattern('*')).toBe(true);
  });

  it('rejects junk entries', () => {
    expect(isValidPattern('')).toBe(false);
    expect(isValidPattern('app.example.com/path')).toBe(false);
    expect(isValidPattern('https://*.example.com/path')).toBe(false);
    expect(isValidPattern('a b')).toBe(false);
    expect(isValidPattern('sub.*.example.com')).toBe(false);
    expect(isValidPattern('example.com:8080')).toBe(false);
    expect(isValidPattern(42 as unknown as string)).toBe(false);
    expect(isValidPattern('https://' + 'a'.repeat(300) + '.com')).toBe(false);
  });
});

describe('originMatches', () => {
  it('matches exact scheme + host, ignoring the port', () => {
    expect(originMatches('https://app.example.com', 'https://app.example.com')).toBe(true);
    expect(originMatches('https://app.example.com', 'https://app.example.com:8443')).toBe(true);
    expect(originMatches('https://app.example.com', 'http://app.example.com')).toBe(false);
    expect(originMatches('https://app.example.com', 'https://other.example.com')).toBe(false);
  });

  it('compares scheme and host case-insensitively', () => {
    expect(originMatches('https://APP.EXAMPLE.COM', 'https://app.example.com')).toBe(true);
    expect(originMatches('https://app.example.com', 'HTTPS://App.Example.Com')).toBe(true);
  });

  it('matches subdomain wildcards including the apex', () => {
    expect(originMatches('https://*.example.com', 'https://example.com')).toBe(true);
    expect(originMatches('https://*.example.com', 'https://app.example.com')).toBe(true);
    expect(originMatches('https://*.example.com', 'https://deep.app.example.com')).toBe(true);
    expect(originMatches('https://*.example.com', 'https://example.org')).toBe(false);
    expect(originMatches('https://*.example.com', 'https://notexample.com')).toBe(false);
    expect(originMatches('https://*.example.com', 'https://app.example.org')).toBe(false);
  });

  it('matches scheme-relative patterns against any scheme', () => {
    expect(originMatches('example.com', 'https://example.com')).toBe(true);
    expect(originMatches('example.com', 'http://example.com')).toBe(true);
    expect(originMatches('*.example.com', 'https://app.example.com')).toBe(true);
    expect(originMatches('*.example.com', 'wss://app.example.com')).toBe(true);
    expect(originMatches('example.com', 'https://other.com')).toBe(false);
  });

  it('honours the open wildcard and rejects malformed origins', () => {
    expect(originMatches('*', 'https://anything.example.com')).toBe(true);
    expect(originMatches('https://app.example.com', 'https://app.example.com/path')).toBe(false);
    expect(originMatches('https://app.example.com', '')).toBe(false);
  });
});

describe('CORSOriginPolicy', () => {
  beforeEach(() => {
    resetCorsMetrics();
  });

  it('seeds from allowedOrigins and lists them sorted', () => {
    const policy = new CORSOriginPolicy({
      allowedOrigins: ['https://b.example.com', 'https://a.example.com'],
    });
    expect(policy.list()).toEqual(['https://a.example.com', 'https://b.example.com']);
    expect(policy.size).toBe(2);
  });

  it('adds and removes entries dynamically', () => {
    const policy = new CORSOriginPolicy();
    expect(policy.add('https://app.example.com')).toBe(1);
    expect(policy.list()).toEqual(['https://app.example.com']);
    expect(policy.add('https://admin.example.com')).toBe(2);

    expect(policy.remove('https://app.example.com')).toBe(true);
    expect(policy.size).toBe(1);
    expect(policy.remove('https://missing.example.com')).toBe(false);
  });

  it('normalises casing on add and keeps removal consistent', () => {
    const policy = new CORSOriginPolicy();
    expect(policy.add('HTTPS://App.Example.COM')).toBe(1);
    expect(policy.list()).toEqual(['https://app.example.com']);
    expect(policy.remove('https://App.Example.com')).toBe(true);
    expect(policy.size).toBe(0);
  });

  it('throws CorsPolicyError on invalid entries', () => {
    const policy = new CORSOriginPolicy();
    expect(() => policy.add('has space')).toThrow(CorsPolicyError);
    expect(() => policy.add('https://x.example.com/path')).toThrow(CorsPolicyError);
    expect(() => policy.add('https://x.example.com?q=1')).toThrow(CorsPolicyError);
    expect(() => policy.add('https://foo*.example.com')).toThrow(CorsPolicyError);
    expect(() => policy.set(['https://ok.example.com', 'https://bad example.com'])).toThrow(CorsPolicyError);
  });

  it('keeps the previous allowlist when set() is given a bad entry (atomic)', () => {
    const policy = new CORSOriginPolicy({ allowedOrigins: ['https://ok.example.com'] });
    expect(() => policy.set(['https://bad example.com'])).toThrow(CorsPolicyError);
    expect(policy.list()).toEqual(['https://ok.example.com']);
    expect(policy.size).toBe(1);
  });

  it('replaces the whole allowlist on set()', () => {
    const policy = new CORSOriginPolicy({ allowedOrigins: ['https://a.example.com'] });
    policy.set(['https://b.example.com', 'https://c.example.com']);
    expect(policy.list()).toEqual(['https://b.example.com', 'https://c.example.com']);
    expect(policy.version).toBe(2);
  });

  it('tracks the wildcard flag with add/remove of "*"', () => {
    const policy = new CORSOriginPolicy();
    expect(policy.wildcard).toBe(false);
    policy.add('*');
    expect(policy.wildcard).toBe(true);
    policy.remove('*');
    expect(policy.wildcard).toBe(false);
  });

  it('isAllowed concedes members only (and counts metrics)', () => {
    const policy = new CORSOriginPolicy({
      allowedOrigins: ['https://app.example.com', 'https://*.static.example.com'],
    });

    expect(policy.isAllowed('https://app.example.com')).toBe(true);
    expect(policy.isAllowed('https://cdn.static.example.com')).toBe(true);
    expect(policy.isAllowed('https://static.example.com')).toBe(true);
    expect(policy.isAllowed('https://hacker.example.org')).toBe(false);

    const m = getCorsMetrics();
    expect(m.allowedRequests).toBe(3);
    expect(m.deniedRequests).toBe(1);
  });

  it('isAllowed denies null, empty, and malformed origins', () => {
    const policy = new CORSOriginPolicy({ allowedOrigins: ['*'] });
    expect(policy.isAllowed(null)).toBe(false);
    expect(policy.isAllowed(undefined)).toBe(false);
    expect(policy.isAllowed('')).toBe(false);
    expect(policy.isAllowed('null')).toBe(false);
    expect(policy.isAllowed('not-a-origin')).toBe(false);
  });

  it('denies everything when the allowlist is empty', () => {
    const policy = new CORSOriginPolicy();
    expect(policy.isAllowed('https://app.example.com')).toBe(false);
  });

  it('allows any valid origin in open mode', () => {
    const policy = new CORSOriginPolicy({ allowedOrigins: ['*'] });
    expect(policy.isAllowed('https://anything.example.com')).toBe(true);
    expect(policy.isAllowed('http://localhost:5173')).toBe(true);
  });

  it('refresh() replaces the list from the loader', async () => {
    const loader = vi.fn().mockResolvedValue(['https://new.example.com', 'https://*.new.example.com']);
    const policy = new CORSOriginPolicy({
      allowedOrigins: ['https://old.example.com'],
      loader,
    });
    const origins = await policy.refresh();
    expect(origins).toEqual(['https://*.new.example.com', 'https://new.example.com']);
    expect(policy.isAllowed('https://old.example.com')).toBe(false);
    expect(policy.isAllowed('https://app.new.example.com')).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('refresh() fails safe: rejects keep the old list', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('source down'));
    const policy = new CORSOriginPolicy({
      allowedOrigins: ['https://old.example.com'],
      loader,
    });
    await expect(policy.refresh()).rejects.toThrow();
    expect(policy.list()).toEqual(['https://old.example.com']);
  });

  it('refresh() rejects loader results with invalid entries', async () => {
    const loader = vi.fn().mockResolvedValue(['https://ok.example.com', 'bad/entry']);
    const policy = new CORSOriginPolicy({
      allowedOrigins: ['https://old.example.com'],
      loader,
    });
    await expect(policy.refresh()).rejects.toThrow(CorsPolicyError);
    expect(policy.list()).toEqual(['https://old.example.com']);
  });

  it('refresh() throws when no loader is configured', async () => {
    const policy = new CORSOriginPolicy({ allowedOrigins: ['https://a.example.com'] });
    await expect(policy.refresh()).rejects.toThrow();
  });
});

describe('shared policy and convenience wrappers', () => {
  afterEach(() => {
    resetCorsMetrics();
    initCorsPolicy({ allowedOrigins: [] });
  });

  it('shares a single default policy across the module', () => {
    expect(getAllowedOrigins()).toEqual([]);
    addAllowedOrigin('https://app.example.com');
    addAllowedOrigin('https://*.example.com');
    expect(getAllowedOrigins()).toEqual(['https://*.example.com', 'https://app.example.com']);
    expect(getCorsPolicy().size).toBe(2);

    expect(removeAllowedOrigin('https://app.example.com')).toBe(true);
    expect(isOriginAllowed('https://x.example.com')).toBe(true);
    expect(isOriginAllowed('https://hacker.org')).toBe(false);
  });

  it('setAllowedOrigins replaces the shared list and is atomic', () => {
    setAllowedOrigins(['https://a.example.com']);
    expect(getAllowedOrigins()).toEqual(['https://a.example.com']);
    expect(() => setAllowedOrigins(['bad entry'])).toThrow(CorsPolicyError);
    expect(getAllowedOrigins()).toEqual(['https://a.example.com']);
  });

  it('refreshAllowedOrigins uses the shared policy loader', async () => {
    initCorsPolicy({
      allowedOrigins: ['https://old.example.com'],
      loader: vi.fn().mockResolvedValue(['https://new.example.com']),
    });
    await expect(refreshAllowedOrigins()).resolves.toEqual(['https://new.example.com']);
  });

  it('recordPreflight and metrics reset', () => {
    recordPreflight(true);
    recordPreflight(true);
    recordPreflight(false);
    const m = getCorsMetrics();
    expect(m.preflights).toBe(3);
    expect(m.preflightDenied).toBe(1);

    resetCorsMetrics();
    expect(getCorsMetrics()).toEqual({
      allowedRequests: 0,
      deniedRequests: 0,
      preflights: 0,
      preflightDenied: 0,
    });
  });
});