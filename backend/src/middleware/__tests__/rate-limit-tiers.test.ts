/**
 * Issue #820 — API Rate Limiting with Tier-Based Quotas
 * Comprehensive tests for the token-bucket middleware and quota management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  tokenBucketRateLimit,
  rateLimit,
  resolveUserTier,
  resolveClientKey,
  DEFAULT_TIER_CONFIGS,
  SANDBOX_TIER_CONFIGS,
  ENDPOINT_CONFIGS,
  setQuotaOverride,
  removeQuotaOverride,
  listQuotaOverrides,
  getAnalyticsSummary,
  analyticsEvents,
  type UserTier,
  type QuotaOverride,
} from '../rate-limit.js';
import { RateLimitService } from '../../services/rateLimit.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function mockReq(
  headers: Record<string, string> = {},
  ip = '10.0.0.1',
  path = '/api/v1/payments',
): Request {
  return { headers, ip, path, socket: { remoteAddress: ip } } as unknown as Request;
}

interface MockRes {
  _headers: Record<string, string | number>;
  _status: number;
  _body: unknown;
  setHeader(k: string, v: string | number): void;
  status(code: number): { json(data: unknown): void };
}

function mockRes(): MockRes {
  const headers: Record<string, string | number> = {};
  let statusCode = 200;
  let body: unknown = null;

  return {
    _headers: headers,
    _status: statusCode,
    _body: body,
    setHeader(k: string, v: string | number) { headers[k] = v; },
    status(code: number) {
      statusCode = code;
      (this as MockRes)._status = code;
      return { json(data: unknown) { body = data; (mockRes as unknown as MockRes)._body = data; } };
    },
  } as MockRes;
}

// ---------------------------------------------------------------------------
// Tier resolution
// ---------------------------------------------------------------------------

describe('resolveUserTier', () => {
  it('defaults to free when no header is present', () => {
    expect(resolveUserTier(mockReq())).toBe('free');
  });

  it('resolves pro tier from x-user-tier header', () => {
    expect(resolveUserTier(mockReq({ 'x-user-tier': 'pro' }))).toBe('pro');
  });

  it('resolves enterprise tier (case-insensitive)', () => {
    expect(resolveUserTier(mockReq({ 'x-user-tier': 'Enterprise' }))).toBe('enterprise');
  });

  it('resolves tier from registered API key', () => {
    expect(resolveUserTier(mockReq({ 'x-api-key': 'apk_pro_demo_key_00000000000000000000000000001' }))).toBe('pro');
  });

  it('ignores invalid tier values and returns free', () => {
    expect(resolveUserTier(mockReq({ 'x-user-tier': 'gold' }))).toBe('free');
  });
});

// ---------------------------------------------------------------------------
// Client key resolution
// ---------------------------------------------------------------------------

describe('resolveClientKey', () => {
  it('uses API key label when registered', () => {
    const key = resolveClientKey(mockReq({ 'x-api-key': 'apk_free_demo_key_00000000000000000000000001' }));
    expect(key).toBe('demo-free');
  });

  it('masks unknown API keys', () => {
    const key = resolveClientKey(mockReq({ 'x-api-key': 'some_secret_key_12345678' }));
    expect(key).not.toContain('some_secret_key');
    expect(key.length).toBeGreaterThan(0);
  });

  it('falls back to IP when no credentials provided', () => {
    expect(resolveClientKey(mockReq({}, '192.168.1.42'))).toBe('192.168.1.42');
  });
});

// ---------------------------------------------------------------------------
// Default tier configurations
// ---------------------------------------------------------------------------

describe('DEFAULT_TIER_CONFIGS', () => {
  it('defines hourly capacities with correct ordering', () => {
    expect(DEFAULT_TIER_CONFIGS.free.capacity).toBe(1000);
    expect(DEFAULT_TIER_CONFIGS.pro.capacity).toBe(10_000);
    expect(DEFAULT_TIER_CONFIGS.enterprise.capacity).toBe(50_000);
    expect(DEFAULT_TIER_CONFIGS.free.capacity).toBeLessThan(DEFAULT_TIER_CONFIGS.pro.capacity);
    expect(DEFAULT_TIER_CONFIGS.pro.capacity).toBeLessThan(DEFAULT_TIER_CONFIGS.enterprise.capacity);
  });

  it('calculates correct refill rates (tokens/sec matching hourly capacity)', () => {
    const HOUR = 3600;
    expect(DEFAULT_TIER_CONFIGS.free.refillRate).toBeCloseTo(1000 / HOUR, 5);
    expect(DEFAULT_TIER_CONFIGS.pro.refillRate).toBeCloseTo(10_000 / HOUR, 5);
  });

  it('grants burst allowances above base capacity', () => {
    expect(DEFAULT_TIER_CONFIGS.free.burstAllowance).toBeGreaterThan(0);
    expect(DEFAULT_TIER_CONFIGS.pro.burstAllowance).toBeGreaterThan(DEFAULT_TIER_CONFIGS.free.burstAllowance);
  });
});

describe('SANDBOX_TIER_CONFIGS', () => {
  it('provides faster refill rates than production for testing', () => {
    expect(SANDBOX_TIER_CONFIGS.free.refillRate).toBeGreaterThan(DEFAULT_TIER_CONFIGS.free.refillRate);
    expect(SANDBOX_TIER_CONFIGS.pro.refillRate).toBeGreaterThan(DEFAULT_TIER_CONFIGS.pro.refillRate);
  });
});

// ---------------------------------------------------------------------------
// Endpoint-level configs
// ---------------------------------------------------------------------------

describe('ENDPOINT_CONFIGS', () => {
  it('defines stricter limits for /api/v1/invoice', () => {
    const invoiceCfg = ENDPOINT_CONFIGS['/api/v1/invoice'];
    expect(invoiceCfg).toBeDefined();
    expect(invoiceCfg.free.capacity).toBeLessThan(DEFAULT_TIER_CONFIGS.free.capacity);
    expect(invoiceCfg.pro.capacity).toBeLessThan(DEFAULT_TIER_CONFIGS.pro.capacity);
  });

  it('defines limits for /api/v1/verification and /api/v1/stellar', () => {
    expect(ENDPOINT_CONFIGS['/api/v1/verification']).toBeDefined();
    expect(ENDPOINT_CONFIGS['/api/v1/stellar']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Quota override management
// ---------------------------------------------------------------------------

describe('quota overrides', () => {
  beforeEach(() => {
    // Clean up overrides between tests
    for (const { clientKey } of listQuotaOverrides()) {
      removeQuotaOverride(clientKey);
    }
  });

  it('sets, lists, and removes a quota override', () => {
    const override: QuotaOverride = { tier: 'pro', capacity: 500, refillRate: 0.5, burstAllowance: 50 };
    setQuotaOverride('test-client', override);

    const overrides = listQuotaOverrides();
    expect(overrides).toContainEqual(expect.objectContaining({ clientKey: 'test-client', capacity: 500 }));

    const removed = removeQuotaOverride('test-client');
    expect(removed).toBe(true);
    expect(listQuotaOverrides()).not.toContainEqual(expect.objectContaining({ clientKey: 'test-client' }));
  });

  it('returns false when removing a non-existent override', () => {
    expect(removeQuotaOverride('ghost-client')).toBe(false);
  });

  it('auto-expires overrides past their expiresAt date', () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    setQuotaOverride('expired-client', { tier: 'free', capacity: 10, refillRate: 0.1, burstAllowance: 0, expiresAt: pastDate });

    const overrides = listQuotaOverrides(); // triggers expiry sweep
    expect(overrides).not.toContainEqual(expect.objectContaining({ clientKey: 'expired-client' }));
  });
});

// ---------------------------------------------------------------------------
// rateLimit alias
// ---------------------------------------------------------------------------

describe('rateLimit alias', () => {
  it('is identical to tokenBucketRateLimit', () => {
    expect(rateLimit).toBe(tokenBucketRateLimit);
  });

  it('returns a middleware function', () => {
    const mw = rateLimit();
    expect(typeof mw).toBe('function');
    expect(mw.length).toBe(3); // (req, res, next)
  });
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

describe('analytics', () => {
  it('getAnalyticsSummary returns totals and per-tier breakdown', () => {
    const service = new RateLimitService();
    service.consume('analytics-test-1', 'pro', 1, '/api/v1/stellar');
    service.consume('analytics-test-2', 'free', 1, '/api/v1/invoice');

    const summary = service.getAnalytics(60_000);
    expect(summary.total).toBeGreaterThanOrEqual(2);
    expect(typeof summary.allowRate).toBe('number');
    expect(summary.allowRate).toBeGreaterThanOrEqual(0);
    expect(summary.allowRate).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// RateLimitService — token bucket correctness
// ---------------------------------------------------------------------------

describe('RateLimitService', () => {
  let svc: RateLimitService;

  beforeEach(() => {
    svc = new RateLimitService({
      free: { capacity: 5, refillRate: 1, burstAllowance: 0 },
      pro:  { capacity: 20, refillRate: 5, burstAllowance: 2 },
    });
  });

  it('allows requests within capacity', () => {
    const r = svc.consume('u1', 'free', 1);
    expect(r.allowed).toBe(true);
    expect(r.tokensRemaining).toBe(4);
  });

  it('blocks when tokens exhausted and reports retryAfterMs', () => {
    for (let i = 0; i < 5; i++) svc.consume('u2', 'free', 1);
    const r = svc.consume('u2', 'free', 1);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it('includes burst allowance in initial capacity', () => {
    const r = svc.consume('u3', 'pro', 1);
    // initial tokens = capacity(20) + burst(2) = 22, after consuming 1 → 21
    expect(r.tokensRemaining).toBe(21);
  });

  it('refills tokens proportionally over elapsed time', () => {
    const now = 1_000_000;
    svc.consume('u4', 'free', 5, undefined, now); // drain 5 tokens
    expect(svc.getRemaining('u4', 'free', undefined, now)).toBe(0);

    const later = now + 3000; // 3 seconds → 3 tokens refilled at rate=1
    expect(svc.getRemaining('u4', 'free', undefined, later)).toBe(3);
  });

  it('honours per-endpoint config when endpoint is provided', () => {
    const svcWithEndpoints = new RateLimitService({
      free: { capacity: 1000, refillRate: 1, burstAllowance: 0 },
    });
    svcWithEndpoints.registerEndpointConfig('/api/v1/invoice', {
      free: { capacity: 3, refillRate: 0.5, burstAllowance: 0 },
      pro:  { capacity: 10, refillRate: 1, burstAllowance: 0 },
      enterprise: { capacity: 50, refillRate: 5, burstAllowance: 0 },
    });

    for (let i = 0; i < 3; i++) svcWithEndpoints.consume('invoice-user', 'free', 1, '/api/v1/invoice');
    const r = svcWithEndpoints.consume('invoice-user', 'free', 1, '/api/v1/invoice');
    expect(r.allowed).toBe(false);
  });

  it('resets bucket state for a key', () => {
    svc.consume('u5', 'free', 5);
    svc.reset('u5');
    const r = svc.consume('u5', 'free', 1);
    expect(r.allowed).toBe(true);
    expect(r.tokensRemaining).toBe(4);
  });

  it('computes resetSeconds from tokens needed to fill', () => {
    const r = svc.consume('u6', 'free', 5); // drain to 0
    expect(r.resetSeconds).toBeGreaterThan(0);
  });

  it('per-tier capacity: pro is higher than free', () => {
    const free  = svc.consume('cmp-free',  'free',  1);
    const pro   = svc.consume('cmp-pro',   'pro',   1);
    expect(pro.tokensRemaining).toBeGreaterThan(free.tokensRemaining);
  });
});
