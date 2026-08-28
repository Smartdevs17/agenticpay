import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateEnv, config, clearEnvCache } from '../env.js';
import { z } from 'zod';

describe('Environment Validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    clearEnvCache();
    vi.stubGlobal('process', {
      ...process,
      exit: vi.fn() as any,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('throws and exits when OPENAI_API_KEY is missing', () => {
    delete process.env.OPENAI_API_KEY;

    // validateEnv calls process.exit(1) and throws in test (mocked exit)
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
});
