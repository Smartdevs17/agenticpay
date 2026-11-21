/**
 * Audit event schema, log-injection and CSV-injection defence — Issue #396
 */
import { describe, expect, it } from 'vitest';

import {
  AuditEventValidationError,
  checkPciDssFieldCompleteness,
  escapeCsvCell,
  normalizeAuditEvent,
  sanitizeAuditDetails,
  sanitizeAuditText,
  sanitizeAuditValue,
} from '../event-schema.js';

describe('sanitizeAuditText', () => {
  it('collapses newlines so a detail value cannot forge an extra log line', () => {
    const forged = 'login\n2026-01-01 INFO actor=root action=admin.delete';
    const safe = sanitizeAuditText(forged);

    expect(safe).not.toContain('\n');
    expect(safe).toBe('login 2026-01-01 INFO actor=root action=admin.delete');
  });

  it('strips carriage returns and control characters', () => {
    expect(sanitizeAuditText('pay\u0000ment\u0007 ok\r\n')).toBe('payment ok');
  });

  it('strips ANSI escape sequences', () => {
    expect(sanitizeAuditText('\u001B[31mred\u001B[0m')).toBe('red');
  });

  it('truncates to the requested length', () => {
    expect(sanitizeAuditText('abcdef', 4)).toBe('abcd');
  });
});

describe('sanitizeAuditValue', () => {
  it('sanitises nested objects and arrays', () => {
    const result = sanitizeAuditValue({
      nested: { forged: 'a\nb' },
      list: ['x\ry', 1, true],
    });

    expect(result).toEqual({ nested: { forged: 'a b' }, list: ['x y', 1, true] });
  });

  it('caps recursion depth rather than throwing on cyclic-ish structures', () => {
    const deep = { a: { b: { c: { d: { e: 'too deep' } } } } };
    expect(JSON.stringify(sanitizeAuditValue(deep))).toContain('[TRUNCATED_DEPTH]');
  });

  it('replaces non-finite numbers so JSON serialisation stays valid', () => {
    expect(sanitizeAuditValue({ n: Number.NaN })).toEqual({ n: null });
  });

  it('keeps detail bags bounded and returns undefined for empty input', () => {
    expect(sanitizeAuditDetails(undefined)).toBeUndefined();
    expect(sanitizeAuditDetails({ ok: 'yes' })).toEqual({ ok: 'yes' });
  });
});

describe('escapeCsvCell', () => {
  it('neutralises spreadsheet formula injection', () => {
    // Quoting alone is not enough: spreadsheet apps still execute cells that
    // begin with a formula character, so it is prefixed with an apostrophe.
    const quote = String.fromCharCode(39);

    expect(escapeCsvCell('=cmd|"/c calc"!A1')).toBe(`"${quote}=cmd|""/c calc""!A1"`);
    expect(escapeCsvCell('+1234')).toBe(`"${quote}+1234"`);
    expect(escapeCsvCell('-1234')).toBe(`"${quote}-1234"`);
    expect(escapeCsvCell('@SUM(A1)')).toBe(`"${quote}@SUM(A1)"`);
  });

  it('quotes and escapes embedded double quotes', () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('renders empty cells for null and undefined', () => {
    expect(escapeCsvCell(null)).toBe('""');
    expect(escapeCsvCell(undefined)).toBe('""');
  });
});

describe('normalizeAuditEvent', () => {
  it('fills in the canonical actor and a numeric timestamp', () => {
    const event = normalizeAuditEvent({ action: 'auth.post', resource: 'auth' });

    expect(event.actor).toBe('system');
    expect(typeof event.timestamp).toBe('number');
    expect(event.timestamp).toBeGreaterThan(0);
  });

  it('sanitises actor, action, resource and details', () => {
    const event = normalizeAuditEvent({
      actor: 'user\n1',
      action: 'auth.post',
      resource: 'auth',
      details: { note: 'line1\nline2' },
    });

    expect(event.actor).toBe('user 1');
    expect(event.details).toEqual({ note: 'line1 line2' });
  });

  it('rejects actions containing characters that could break the log format', () => {
    expect(() => normalizeAuditEvent({ action: 'auth post; rm -rf /', resource: 'auth' })).toThrow(
      AuditEventValidationError
    );
  });

  it('rejects an empty resource', () => {
    expect(() => normalizeAuditEvent({ action: 'auth.post', resource: '' })).toThrow(AuditEventValidationError);
  });

  it('accepts an ISO timestamp and normalises it to epoch milliseconds', () => {
    const iso = '2026-01-01T00:00:00.000Z';
    expect(normalizeAuditEvent({ action: 'auth.post', resource: 'auth', timestamp: iso }).timestamp).toBe(
      Date.parse(iso)
    );
  });
});

describe('checkPciDssFieldCompleteness', () => {
  it('reports the fields PCI-DSS 10.3 expects but that are missing', () => {
    const event = normalizeAuditEvent({ action: 'auth.post', resource: 'auth' });
    const result = checkPciDssFieldCompleteness(event);

    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining(['successOrFailure', 'originOfEvent']));
  });

  it('reports completeness when every required field is present', () => {
    const event = normalizeAuditEvent({
      action: 'auth.post',
      resource: 'auth',
      outcome: 'success',
      ipAddress: '203.0.113.7',
      actor: 'user-1',
    });

    expect(checkPciDssFieldCompleteness(event)).toEqual({ complete: true, missing: [] });
  });
});
