import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveClientKey,
  resolveUserTier,
  DEFAULT_TIER_CONFIGS,
  rateLimit,
} from '../rate-limit.js';
import {
  RateLimitService,
  DEFAULT_TIER_CONFIGS as SERVICE_TIERS,
} from '../../services/rateLimit.js';

function mockReq(headers: Record<string, string> = {}, ip = '127.0.0.1', path = '/api/v1/invoice') {
  return {
    headers,
    ip,
    path,
    socket: { remoteAddress: ip },
  } as any;
}

function mockRes() {
  const headers: Record<string, string | number> = {};
  let statusCode = 200;
  let body: any = null;

  return {
    setHeader: (k: string, v: string | number) => {
      headers[k] = v;
    },
    status: (code: number) => {
      statusCode = code;
      return {
        json: (data: any) => {
          body = data;
        },
      };
    },
    get headers() {
      return headers;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  } as any;
}

describe('per-api-key rate limiting middleware', () => {
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

describe('TokenBucket RateLimitService', () => {
  let service: RateLimitService;

  beforeEach(() => {
    service = new RateLimitService();
  });

  it('allows requests within capacity and tracks tokens remaining', () => {
    const res = service.consume('user-1', 'free', 1);
    expect(res.allowed).toBe(true);
    expect(res.tokensRemaining).toBeLessThanOrEqual(SERVICE_TIERS.free.capacity + SERVICE_TIERS.free.burstAllowance);
    expect(res.capacity).toBe(SERVICE_TIERS.free.capacity);
  });

  it('blocks requests when capacity is exhausted and computes retryAfterMs', () => {
    const customService = new RateLimitService({
      free: { capacity: 2, refillRate: 1, burstAllowance: 0 },
    });

    const r1 = customService.consume('user-2', 'free', 1);
    expect(r1.allowed).toBe(true);

    const r2 = customService.consume('user-2', 'free', 1);
    expect(r2.allowed).toBe(true);

    const r3 = customService.consume('user-2', 'free', 1);
    expect(r3.allowed).toBe(false);
    expect(r3.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills tokens over time', () => {
    const customService = new RateLimitService({
      free: { capacity: 5, refillRate: 10, burstAllowance: 0 },
    });

    const now = 1000000;
    // consume 5 tokens
    customService.consume('user-3', 'free', 5, undefined, now);
    expect(customService.getRemaining('user-3', 'free', undefined, now)).toBe(0);

    // after 500ms, 5 tokens refill (10 tokens/sec * 0.5 sec = 5 tokens)
    const later = now + 500;
    expect(customService.getRemaining('user-3', 'free', undefined, later)).toBe(5);
  });

  it('records analytics and aggregates by tier and endpoint', () => {
    service.consume('client-a', 'pro', 1, '/api/v1/stellar');
    service.consume('client-b', 'free', 1, '/api/v1/invoice');

    const analytics = service.getAnalytics();
    expect(analytics.total).toBe(2);
    expect(analytics.blocked).toBe(0);
    expect(analytics.byTier.pro.total).toBe(1);
    expect(analytics.byTier.free.total).toBe(1);
  });
});
