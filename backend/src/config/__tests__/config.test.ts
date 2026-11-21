import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { validateEnv, config, clearEnvCache } from '../env.js';

describe('Config Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    clearEnvCache();
    vi.stubGlobal('process', {
      ...process,
      env: process.env,
      exit: vi.fn() as any,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  describe('validateEnv', () => {
    it('throws and exits when OPENAI_API_KEY is missing', () => {
      delete process.env.OPENAI_API_KEY;

      expect(() => validateEnv()).toThrow();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('successfully parses valid environment variables', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.PORT = '4000';
      process.env.STELLAR_NETWORK = 'public';

      const parsed = validateEnv();

      expect(parsed.OPENAI_API_KEY).toBe('test-key');
      expect(parsed.PORT).toBe(4000);
      expect(parsed.STELLAR_NETWORK).toBe('public');
    });

    it('uses default values for optional variables', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      delete process.env.PORT;
      delete process.env.STELLAR_NETWORK;

      const parsed = validateEnv();

      expect(parsed.PORT).toBe(3001);
      expect(parsed.STELLAR_NETWORK).toBe('testnet');
    });

    it('transforms JOBS_ENABLED correctly', () => {
      process.env.OPENAI_API_KEY = 'test-key';

      process.env.JOBS_ENABLED = 'false';
      clearEnvCache();
      expect(validateEnv().JOBS_ENABLED).toBe(false);

      process.env.JOBS_ENABLED = 'true';
      clearEnvCache();
      expect(validateEnv().JOBS_ENABLED).toBe(true);

      process.env.JOBS_ENABLED = 'any-other-string';
      clearEnvCache();
      expect(validateEnv().JOBS_ENABLED).toBe(true);
    });

    it('transforms QUEUE_ENABLED correctly', () => {
      process.env.OPENAI_API_KEY = 'test-key';

      process.env.QUEUE_ENABLED = 'false';
      clearEnvCache();
      expect(validateEnv().QUEUE_ENABLED).toBe(false);

      process.env.QUEUE_ENABLED = 'true';
      clearEnvCache();
      expect(validateEnv().QUEUE_ENABLED).toBe(true);
    });

    it('validates CORS_ALLOWED_ORIGINS', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.CORS_ALLOWED_ORIGINS = 'https://example.com';

      const parsed = validateEnv();
      expect(parsed.CORS_ALLOWED_ORIGINS).toBe('https://example.com');
    });

    it('validates RATE_LIMIT values', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.RATE_LIMIT_FREE = '50';
      process.env.RATE_LIMIT_PRO = '200';
      process.env.RATE_LIMIT_ENTERPRISE = '500';
      process.env.RATE_LIMIT_WINDOW_MS = '60000';

      const parsed = validateEnv();

      expect(parsed.RATE_LIMIT_FREE).toBe(50);
      expect(parsed.RATE_LIMIT_PRO).toBe(200);
      expect(parsed.RATE_LIMIT_ENTERPRISE).toBe(500);
      expect(parsed.RATE_LIMIT_WINDOW_MS).toBe(60000);
    });

    it('validates IP_ALLOWLIST settings', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.IP_ALLOWLIST = '192.168.1.1,10.0.0.1';
      process.env.IP_ALLOWLIST_ENABLED = 'true';
      process.env.IP_ALLOWLIST_BYPASS_ENABLED = 'true';
      process.env.IP_ALLOWLIST_BYPASS_EXPIRY_MS = '1800000';

      const parsed = validateEnv();

      expect(parsed.IP_ALLOWLIST).toBe('192.168.1.1,10.0.0.1');
      expect(parsed.IP_ALLOWLIST_ENABLED).toBe(true);
      expect(parsed.IP_ALLOWLIST_BYPASS_ENABLED).toBe(true);
      expect(parsed.IP_ALLOWLIST_BYPASS_EXPIRY_MS).toBe(1800000);
    });
  });

  describe('config', () => {
    it('returns cached config after first call', () => {
      process.env.OPENAI_API_KEY = 'test-key';

      const first = config();
      const second = config();

      expect(first).toBe(second);
    });

    it('validates on first call', () => {
      process.env.OPENAI_API_KEY = 'test-key';

      const parsed = config();

      expect(parsed.OPENAI_API_KEY).toBe('test-key');
    });
  });
});