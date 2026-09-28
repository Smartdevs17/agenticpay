import { describe, it, expect } from 'vitest';
import {
  resolveClientKey,
  resolveUserTier,
  DEFAULT_TIER_CONFIGS,
} from '../middleware/rate-limit.js';

function mockReq(headers: Record<string, string> = {}, ip = '127.0.0.1') {
  return {
    headers,
    ip,
    path: '/api/v1/invoice',
  } as any;
}

describe('per-api-key rate limiting', () => {
  it('resolves tier from registered API keys', () => {
    const req = mockReq({ 'x-api-key': 'apk_pro_demo_key_00000000000000000000000000001' });
    expect(resolveUserTier(req)).toBe('pro');
  });

  it('masks client keys in analytics identifiers', () => {
    const req = mockReq({ 'x-api-key': 'apk_free_demo_key_00000000000000000000000001' });
    const key = resolveClientKey(req);
    expect(key).toBe('demo-free');
    expect(key).not.toContain('apk_free');
  });

  it('defines hourly tier capacities', () => {
    expect(DEFAULT_TIER_CONFIGS.free.capacity).toBe(1000);
    expect(DEFAULT_TIER_CONFIGS.pro.capacity).toBe(10000);
    expect(DEFAULT_TIER_CONFIGS.enterprise.capacity).toBeGreaterThan(10000);
  });
});
