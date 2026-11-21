import { describe, it, expect } from 'vitest';
import { PiiClassifier, piiClassifier } from '../../services/pii/pii-classifier.js';

describe('PiiClassifier', () => {
  describe('scanString', () => {
    it('detects email', () => {
      const d = piiClassifier.scanString('contact user@example.com now');
      expect(d.some(x => x.type === 'email')).toBe(true);
    });

    it('detects SSN', () => {
      const d = piiClassifier.scanString('ssn: 123-45-6789');
      expect(d.some(x => x.type === 'ssn')).toBe(true);
    });

    it('detects API key', () => {
      const d = piiClassifier.scanString('key=sk_live_abcdefghijklmnop');
      expect(d.some(x => x.type === 'api_key')).toBe(true);
    });

    it('returns empty for clean strings', () => {
      const d = piiClassifier.scanString('hello world, no pii here');
      expect(d).toHaveLength(0);
    });
  });

  describe('classify', () => {
    it('redacts email in nested object', () => {
      const { redacted, detections } = piiClassifier.classify({
        user: { email: 'alice@example.com', name: 'Alice' },
      });
      expect(detections.length).toBeGreaterThan(0);
      // original email is replaced with the mask
      expect((redacted as any).user.email).not.toBe('alice@example.com');
    });

    it('does not mutate original object', () => {
      const original = { email: 'test@test.com' };
      piiClassifier.classify(original);
      expect(original.email).toBe('test@test.com');
    });

    it('handles arrays', () => {
      const { redacted } = piiClassifier.classify({ emails: ['a@b.com', 'c@d.com'] });
      const emails = (redacted as any).emails as string[];
      // each address should be replaced with the mask, not the original
      expect(emails.every((e: string) => e !== 'a@b.com' && e !== 'c@d.com')).toBe(true);
    });

    it('passes through non-PII values unchanged', () => {
      const { redacted } = piiClassifier.classify({ count: 42, label: 'payment' });
      expect((redacted as any).count).toBe(42);
      expect((redacted as any).label).toBe('payment');
    });
  });

  describe('classification levels', () => {
    it('strict level detects EVM crypto address', () => {
      const strict = new PiiClassifier('strict');
      const d = strict.scanString('wallet: 0xAbCdEf1234567890abcdef1234567890ABCDEF12');
      expect(d.some(x => x.type === 'crypto_address')).toBe(true);
    });

    it('permissive level skips crypto addresses', () => {
      const permissive = new PiiClassifier('permissive');
      const d = permissive.scanString('wallet: 0xAbCdEf1234567890abcdef1234567890ABCDEF12');
      expect(d.some(x => x.type === 'crypto_address')).toBe(false);
    });
  });

  describe('custom patterns', () => {
    it('detects custom pattern', () => {
      const c = new PiiClassifier('standard');
      c.addPattern({ type: 'custom', regex: /EMP-\d{6}/g, minLevel: 'standard' });
      const d = c.scanString('id: EMP-123456');
      expect(d.some(x => x.type === 'custom')).toBe(true);
    });
  });
});
