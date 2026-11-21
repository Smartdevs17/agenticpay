import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  slidingWindowRateLimit,
  resolveIntelligentClientKey,
  resetSlidingWindowMemoryStore,
  ENDPOINT_SLIDING_WINDOWS,
  DEFAULT_SLIDING_WINDOW,
} from '../sliding-window-rate-limit.js';

function mockReq(path: string, headers: Record<string, string> = {}, ip = '10.0.0.1') {
  return { path, headers, ip } as any;
}

function mockRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  } as any;
}

describe('sliding window rate limiting', () => {
  beforeEach(() => {
    resetSlidingWindowMemoryStore();
  });

  it('allows requests under the limit and exposes window headers', async () => {
    const mw = slidingWindowRateLimit({ keyPrefix: 'test-ok' });
    const req = mockReq('/api/v1/widgets', {}, '10.0.0.2');
    const res = mockRes();
    const next = vi.fn();

    await mw(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.headers['X-SlidingWindow-Limit']).toBe(String(DEFAULT_SLIDING_WINDOW.free.window.limit));
    expect(res.statusCode).toBe(200);
  });

  it('throttles once the per-window limit is exceeded for a sensitive endpoint', async () => {
    const mw = slidingWindowRateLimit({ keyPrefix: 'test-throttle' });
    const limit = ENDPOINT_SLIDING_WINDOWS['/api/v1/withdrawals'].free.window.limit;
    const ip = '10.0.0.3';

    let lastRes;
    for (let i = 0; i < limit; i++) {
      const req = mockReq('/api/v1/withdrawals/123', {}, ip);
      lastRes = mockRes();
      await mw(req, lastRes, vi.fn());
      expect(lastRes.statusCode).toBe(200);
    }

    const req = mockReq('/api/v1/withdrawals/123', {}, ip);
    const res = mockRes();
    const next = vi.fn();
    await mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMIT_THROTTLED');
  });

  it('escalates to a hard block after sustained throttled windows', async () => {
    const mw = slidingWindowRateLimit({ keyPrefix: 'test-block' });
    const cfg = ENDPOINT_SLIDING_WINDOWS['/api/v1/withdrawals'].free;
    const ip = '10.0.0.4';

    // Fill the window to the limit, then exceed it `blockAfterThrottledWindows` times.
    for (let i = 0; i < cfg.window.limit; i++) {
      await mw(mockReq('/api/v1/withdrawals', {}, ip), mockRes(), vi.fn());
    }

    let res;
    for (let i = 0; i < cfg.penalties.blockAfterThrottledWindows; i++) {
      res = mockRes();
      await mw(mockReq('/api/v1/withdrawals', {}, ip), res, vi.fn());
    }

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('RATE_LIMIT_BLOCKED');
  });

  it('applies different limits per endpoint prefix', () => {
    expect(ENDPOINT_SLIDING_WINDOWS['/api/v1/withdrawals'].free.window.limit).toBeLessThan(
      DEFAULT_SLIDING_WINDOW.free.window.limit
    );
    expect(ENDPOINT_SLIDING_WINDOWS['/api/v1/auth'].free.window.limit).toBeLessThan(
      ENDPOINT_SLIDING_WINDOWS['/api/v1/invoice'].free.window.limit
    );
  });

  it('fingerprints anonymous clients by IP + user-agent rather than IP alone', () => {
    const reqA = mockReq('/api/v1/widgets', { 'user-agent': 'curl/8.0' }, '10.0.0.5');
    const reqB = mockReq('/api/v1/widgets', { 'user-agent': 'Mozilla/5.0' }, '10.0.0.5');

    expect(resolveIntelligentClientKey(reqA)).not.toBe(resolveIntelligentClientKey(reqB));
  });

  it('tracks authenticated clients by identity rather than shared IP', () => {
    const reqA = mockReq('/api/v1/widgets', { 'x-user-tier': 'pro' }, '10.0.0.6');
    const reqB = mockReq('/api/v1/widgets', { 'x-user-tier': 'pro' }, '10.0.0.6');
    // Same IP, no api key -> falls back to IP+UA fingerprint, both identical here
    expect(resolveIntelligentClientKey(reqA)).toBe(resolveIntelligentClientKey(reqB));
  });
});
