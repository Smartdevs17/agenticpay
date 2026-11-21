import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  logger,
  redactForTenant,
  setTenantRedactionPolicy,
  removeTenantRedactionPolicy,
  clearTenantRedactionPolicies,
} from '../logger.js';
import { runWithLogContext } from '../../logging/context.js';

function captured(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')).join('\n');
}

describe('utils/logger tenant-scoped redaction (#1492)', () => {
  let info: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearTenantRedactionPolicies();
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('base redaction (every tenant)', () => {
    it('redacts secret-named keys', () => {
      logger.info({ password: 'hunter2', apiKey: 'abc' });
      expect(captured(info)).not.toContain('hunter2');
      expect(captured(info)).toContain('[REDACTED]');
    });

    it('redacts emails inside strings', () => {
      logger.warn('user jane@example.com failed');
      expect(captured(warn)).toContain('[REDACTED_EMAIL]');
      expect(captured(warn)).not.toContain('jane@example.com');
    });

    it('redacts Error messages and keeps the error name', () => {
      logger.error(new Error('lookup failed for bob@example.com'));
      const out = captured(error);
      expect(out).toContain('Error');
      expect(out).not.toContain('bob@example.com');
    });

    it('does not treat an epoch-millisecond timestamp as a card number', () => {
      logger.info({ timestamp: 1_800_000_000_000 });
      expect(captured(info)).toContain('1800000000000');
      expect(captured(info)).not.toContain('REDACTED_CARD');
    });

    it('still redacts a real card number that passes the Luhn check', () => {
      logger.info('card 4111 1111 1111 1111 declined');
      expect(captured(info)).toContain('[REDACTED_CARD]');
      expect(captured(info)).not.toContain('4111 1111 1111 1111');
    });

    it('fails closed on cyclic objects instead of throwing or leaking', () => {
      const cyclic: Record<string, unknown> = { name: 'loop' };
      cyclic.self = cyclic;
      expect(() => logger.info(cyclic)).not.toThrow();
      expect(captured(info)).toContain('[REDACTION_FAILED]');
    });
  });

  describe('tenant policy', () => {
    it('redacts tenant-specific keys only for that tenant', () => {
      setTenantRedactionPolicy('tenant-a', { sensitiveKeys: ['taxId'] });

      runWithLogContext({ traceId: 't', tenantId: 'tenant-a' }, () => {
        logger.info({ taxId: '123-45-6789', name: 'Acme' });
      });
      runWithLogContext({ traceId: 't', tenantId: 'tenant-b' }, () => {
        logger.info({ taxId: 'visible-for-b' });
      });

      const out = captured(info);
      expect(out).not.toContain('123-45-6789');
      expect(out).toContain('visible-for-b');
      expect(out).toContain('Acme');
    });

    it('matches tenant keys case-insensitively', () => {
      setTenantRedactionPolicy('tenant-a', { sensitiveKeys: ['TaxID'] });
      expect(redactForTenant({ taxid: 'x' }, 'tenant-a')).toEqual({ taxid: '[REDACTED]' });
    });

    it('applies tenant string patterns with a named placeholder', () => {
      setTenantRedactionPolicy('tenant-a', {
        patterns: [{ name: 'IBAN', pattern: /\bGB\d{2}[A-Z0-9]{14,18}\b/ }],
      });
      const out = redactForTenant('paid to GB29NWBK60161331926819 today', 'tenant-a');
      expect(out).toBe('paid to [REDACTED_IBAN] today');
    });

    it('cannot disable base redaction', () => {
      setTenantRedactionPolicy('tenant-a', { sensitiveKeys: ['other'] });
      expect(redactForTenant({ password: 'p' }, 'tenant-a')).toEqual({ password: '[REDACTED]' });
    });

    it('applies tenant policy to pino-style records through the shared function', () => {
      setTenantRedactionPolicy('tenant-a', { sensitiveKeys: ['iban'] });
      expect(redactForTenant({ msg: 'ok', iban: 'GB00' }, 'tenant-a')).toEqual({ msg: 'ok', iban: '[REDACTED]' });
    });

    it('removing a policy restores base-only redaction for that tenant', () => {
      setTenantRedactionPolicy('tenant-a', { sensitiveKeys: ['taxId'] });
      removeTenantRedactionPolicy('tenant-a');
      expect(redactForTenant({ taxId: 'x' }, 'tenant-a')).toEqual({ taxId: 'x' });
    });

    it('rejects an empty sensitive key', () => {
      expect(() => setTenantRedactionPolicy('tenant-a', { sensitiveKeys: [' '] })).toThrow(/empty/);
    });

    it('rejects a pattern name that is not UPPER_SNAKE_CASE', () => {
      expect(() =>
        setTenantRedactionPolicy('tenant-a', { patterns: [{ name: 'lower', pattern: /x/ }] })
      ).toThrow(/UPPER_SNAKE_CASE/);
    });

    it('requires a tenant id', () => {
      expect(() => setTenantRedactionPolicy('', { sensitiveKeys: ['x'] })).toThrow(/tenantId/);
    });
  });
});
