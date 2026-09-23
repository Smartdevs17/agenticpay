import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPrismaPoolConfig } from './database.js';

describe('applyPrismaPoolConfig', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('maps configured pool limits and timeouts to Prisma URL options', () => {
    vi.stubEnv('DB_POOL_MAX', '32');
    vi.stubEnv('DB_ACQUIRE_TIMEOUT_MS', '4500');
    vi.stubEnv('DB_CREATE_TIMEOUT_MS', '2500');

    const result = new URL(applyPrismaPoolConfig('postgresql://db/app', 'production')!);

    expect(result.searchParams.get('connection_limit')).toBe('32');
    expect(result.searchParams.get('pool_timeout')).toBe('5');
    expect(result.searchParams.get('connect_timeout')).toBe('3');
  });

  it('leaves database configuration absent when no URL is configured', () => {
    expect(applyPrismaPoolConfig(undefined)).toBeUndefined();
  });
});
