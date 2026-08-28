import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveEnvironmentName,
  getEnvironmentOverrides,
  applyEnvironmentFileDefaults,
  refreshSecretsManagerConfig,
  developmentOverrides,
  stagingOverrides,
  productionOverrides,
} from '../environments';
import type { EnvironmentName } from '../environments/types';

describe('Environment Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    vi.stubGlobal('process', {
      ...process,
      env: process.env,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  describe('resolveEnvironmentName', () => {
    it('returns development for undefined NODE_ENV', () => {
      delete process.env.NODE_ENV;
      expect(resolveEnvironmentName(undefined)).toBe('development');
    });

    it('returns development for development NODE_ENV', () => {
      process.env.NODE_ENV = 'development';
      expect(resolveEnvironmentName('development')).toBe('development');
    });

    it('returns staging for staging NODE_ENV', () => {
      process.env.NODE_ENV = 'staging';
      expect(resolveEnvironmentName('staging')).toBe('staging');
    });

    it('returns production for production NODE_ENV', () => {
      process.env.NODE_ENV = 'production';
      expect(resolveEnvironmentName('production')).toBe('production');
    });

    it('defaults to development for unknown NODE_ENV', () => {
      process.env.NODE_ENV = 'unknown';
      expect(resolveEnvironmentName('unknown')).toBe('development');
    });
  });

  describe('getEnvironmentOverrides', () => {
    it('returns development overrides', () => {
      const overrides = getEnvironmentOverrides('development');
      expect(overrides.CORS_ALLOWED_ORIGINS).toBe('*');
      expect(overrides.STELLAR_NETWORK).toBe('testnet');
      expect(overrides.JOBS_ENABLED).toBe('true');
      expect(overrides.QUEUE_ENABLED).toBe('true');
      expect(overrides.AWS_SECRETS_MANAGER_ENABLED).toBe('false');
    });

    it('returns staging overrides', () => {
      const overrides = getEnvironmentOverrides('staging');
      expect(overrides.CORS_ALLOWED_ORIGINS).toBe('https://staging.agenticpay.app');
      expect(overrides.STELLAR_NETWORK).toBe('testnet');
      expect(overrides.RATE_LIMIT_FREE).toBe('100');
      expect(overrides.AWS_SECRETS_MANAGER_ENABLED).toBe('true');
    });

    it('returns production overrides', () => {
      const overrides = getEnvironmentOverrides('production');
      expect(overrides.CORS_ALLOWED_ORIGINS).toBe('https://app.agenticpay.io');
      expect(overrides.STELLAR_NETWORK).toBe('public');
      expect(overrides.RATE_LIMIT_FREE).toBe('60');
      expect(overrides.RATE_LIMIT_ENTERPRISE).toBe('2000');
      expect(overrides.AWS_SECRETS_MANAGER_SECRET_ID).toBe('agenticpay-prod-app-secrets');
    });
  });

  describe('applyEnvironmentFileDefaults', () => {
    it('applies development defaults when NODE_ENV not set', () => {
      delete process.env.NODE_ENV;
      delete process.env.CORS_ALLOWED_ORIGINS;
      delete process.env.STELLAR_NETWORK;

      const envName = applyEnvironmentFileDefaults();

      expect(envName).toBe('development');
      expect(process.env.CORS_ALLOWED_ORIGINS).toBe('*');
      expect(process.env.STELLAR_NETWORK).toBe('testnet');
    });

    it('does not override existing environment variables', () => {
      process.env.CORS_ALLOWED_ORIGINS = 'https://custom.com';
      process.env.NODE_ENV = 'development';

      applyEnvironmentFileDefaults();

      expect(process.env.CORS_ALLOWED_ORIGINS).toBe('https://custom.com');
    });

    it('applies staging defaults', () => {
      process.env.NODE_ENV = 'staging';
      delete process.env.CORS_ALLOWED_ORIGINS;
      delete process.env.STELLAR_NETWORK;

      applyEnvironmentFileDefaults();

      expect(process.env.CORS_ALLOWED_ORIGINS).toBe('https://staging.agenticpay.app');
      expect(process.env.STELLAR_NETWORK).toBe('testnet');
    });

    it('applies production defaults', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.CORS_ALLOWED_ORIGINS;
      delete process.env.STELLAR_NETWORK;

      applyEnvironmentFileDefaults();

      expect(process.env.CORS_ALLOWED_ORIGINS).toBe('https://app.agenticpay.io');
      expect(process.env.STELLAR_NETWORK).toBe('public');
    });
  });

  describe('Environment Overrides Objects', () => {
    it('developmentOverrides has correct values', () => {
      expect(developmentOverrides.CORS_ALLOWED_ORIGINS).toBe('*');
      expect(developmentOverrides.STELLAR_NETWORK).toBe('testnet');
      expect(developmentOverrides.JOBS_ENABLED).toBe('true');
      expect(developmentOverrides.QUEUE_ENABLED).toBe('true');
      expect(developmentOverrides.AWS_SECRETS_MANAGER_ENABLED).toBe('false');
    });

    it('stagingOverrides has correct values', () => {
      expect(stagingOverrides.CORS_ALLOWED_ORIGINS).toBe('https://staging.agenticpay.app');
      expect(stagingOverrides.STELLAR_NETWORK).toBe('testnet');
      expect(stagingOverrides.RATE_LIMIT_FREE).toBe('100');
      expect(stagingOverrides.AWS_SECRETS_MANAGER_ENABLED).toBe('true');
      expect(stagingOverrides.AWS_SECRETS_MANAGER_SECRET_ID).toBe('agenticpay-staging-app-secrets');
    });

    it('productionOverrides has correct values', () => {
      expect(productionOverrides.CORS_ALLOWED_ORIGINS).toBe('https://app.agenticpay.io');
      expect(productionOverrides.STELLAR_NETWORK).toBe('public');
      expect(productionOverrides.RATE_LIMIT_FREE).toBe('60');
      expect(productionOverrides.RATE_LIMIT_PRO).toBe('300');
      expect(productionOverrides.RATE_LIMIT_ENTERPRISE).toBe('2000');
      expect(productionOverrides.AWS_SECRETS_MANAGER_ENABLED).toBe('true');
      expect(productionOverrides.AWS_SECRETS_MANAGER_SECRET_ID).toBe('agenticpay-prod-app-secrets');
    });
  });

  describe('refreshSecretsManagerConfig', () => {
    it('returns null when secrets manager not enabled', async () => {
      process.env.AWS_SECRETS_MANAGER_ENABLED = 'false';

      const result = await refreshSecretsManagerConfig();

      expect(result).toBeNull();
    });

    it('returns null when secret ID not set', async () => {
      process.env.AWS_SECRETS_MANAGER_ENABLED = 'true';
      delete process.env.AWS_SECRETS_MANAGER_SECRET_ID;

      const result = await refreshSecretsManagerConfig();

      expect(result).toBeNull();
    });
  });
});