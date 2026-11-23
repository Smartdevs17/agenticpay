import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  DEFAULT_VERIFICATION_QUOTAS,
  InMemoryVerificationQuotaStore,
  RedisVerificationQuotaStore,
  VerificationQuotaService,
  resolveVerificationAgent,
  verificationQuota,
  type VerificationAgent,
  type VerificationQuotaStore,
} from '../verification.js';

const FREE_KEY = 'apk_free_demo_key_00000000000000000000000001';
const PRO_KEY = 'apk_pro_demo_key_00000000000000000000000000001';
// 2026-11-23T10:00:30Z: 30 s into a minute.
const NOW = Date.UTC(2026, 10, 23, 10, 0, 30);

const anon: VerificationAgent = { id: 'ip:203.0.113.7', tier: 'anonymous' };

function service(options: ConstructorParameters<typeof VerificationQuotaService>[0] = {}) {
  let now = NOW;
  const svc = new VerificationQuotaService({ now: () => now, ...options });
  return { svc, advance: (ms: number) => (now += ms) };
}

function fakeReq(init: { headers?: Record<string, string>; ip?: string; user?: Request['user'] }): Request {
  return { headers: init.headers ?? {}, ip: init.ip ?? '203.0.113.7', user: init.user } as unknown as Request;
}

describe('resolveVerificationAgent (#1480)', () => {
  it('uses the registry tier for a known API key and never keys on the raw credential', () => {
    const agent = resolveVerificationAgent(fakeReq({ headers: { 'x-api-key': PRO_KEY } }));
    expect(agent.tier).toBe('pro');
    expect(agent.id).toMatch(/^key:[0-9a-f]{32}$/);
    expect(agent.id).not.toContain(PRO_KEY);
  });

  it('uses the authenticated principal, scoped by tenant', () => {
    const agent = resolveVerificationAgent(
      fakeReq({ user: { id: 'agent-7', tenantId: 't1', role: 'enterprise', method: 'token' } }),
    );
    expect(agent).toEqual({ id: 'principal:t1:agent-7', tier: 'enterprise' });
  });

  it('treats a principal with a non-tier role as free', () => {
    const agent = resolveVerificationAgent(fakeReq({ user: { id: 'u', tenantId: 't1', role: 'admin', method: 'session' } }));
    expect(agent.tier).toBe('free');
  });

  it('falls back to an anonymous agent per IP and ignores self-declared identity and tier', () => {
    const a = resolveVerificationAgent(fakeReq({ headers: { 'x-user-tier': 'enterprise', 'x-agent-id': 'agent-a' } }));
    const b = resolveVerificationAgent(fakeReq({ headers: { 'x-agent-id': 'agent-b' } }));
    expect(a).toEqual({ id: 'ip:203.0.113.7', tier: 'anonymous' });
    expect(b).toEqual(a);
  });

  it('does not grant a tier for an unknown API key', () => {
    expect(resolveVerificationAgent(fakeReq({ headers: { 'x-api-key': 'apk_made_up' } })).tier).toBe('anonymous');
  });
});

describe('VerificationQuotaService', () => {
  it('allows up to the per-minute limit, then reports when the minute resets', async () => {
    const { svc } = service();
    for (let i = 0; i < DEFAULT_VERIFICATION_QUOTAS.anonymous.perMinute; i += 1) {
      expect((await svc.consume(anon, 1)).allowed).toBe(true);
    }
    const denied = await svc.consume(anon, 1);
    expect(denied).toMatchObject({ allowed: false, exceeded: 'minute', retryAfterMs: 30_000 });
  });

  it('starts a fresh minute window but keeps counting toward the day', async () => {
    const { svc, advance } = service({ limits: { anonymous: { perMinute: 2, perDay: 3 } } });
    await svc.consume(anon, 2);
    advance(30_000);
    const next = await svc.consume(anon, 1);
    expect(next.allowed).toBe(true);
    expect(next.windows.find((w) => w.window === 'day')).toMatchObject({ used: 3, remaining: 0 });

    advance(60_000);
    const denied = await svc.consume(anon, 1);
    expect(denied.exceeded).toBe('day');
    // Resets at the next UTC midnight.
    expect(denied.retryAfterMs).toBe(Date.UTC(2026, 10, 24) - (NOW + 90_000));
  });

  it('charges a batch for every item, all or nothing', async () => {
    const { svc } = service({ limits: { anonymous: { perMinute: 5, perDay: 50 } } });
    await svc.consume(anon, 3);
    const tooMany = await svc.consume(anon, 3);
    expect(tooMany.allowed).toBe(false);
    // The rejected batch consumed nothing, so two single verifications still fit.
    expect((await svc.consume(anon, 2)).allowed).toBe(true);
  });

  it('flags a batch larger than a whole window as too large instead of asking to retry', async () => {
    const { svc } = service();
    const decision = await svc.consume(anon, DEFAULT_VERIFICATION_QUOTAS.anonymous.perMinute + 1);
    expect(decision).toMatchObject({ allowed: false, tooLarge: true, exceeded: 'minute' });
    expect(decision.retryAfterMs).toBeUndefined();
  });

  it('keeps agents independent', async () => {
    const { svc } = service({ limits: { anonymous: { perMinute: 1, perDay: 10 } } });
    await svc.consume(anon, 1);
    expect((await svc.consume({ id: 'ip:198.51.100.1', tier: 'anonymous' }, 1)).allowed).toBe(true);
    expect((await svc.consume(anon, 1)).allowed).toBe(false);
  });

  it('applies per-agent overrides on top of the tier defaults', async () => {
    const { svc } = service();
    const agent: VerificationAgent = { id: 'key:abc', tier: 'free' };
    svc.setOverride(agent.id, { perMinute: 1 });
    expect(svc.limitsFor(agent)).toEqual({ perMinute: 1, perDay: DEFAULT_VERIFICATION_QUOTAS.free.perDay });
    await svc.consume(agent, 1);
    expect((await svc.consume(agent, 1)).allowed).toBe(false);
    svc.removeOverride(agent.id);
    expect((await svc.consume(agent, 1)).allowed).toBe(true);
  });

  it('keeps enforcing with local counters when the shared store fails', async () => {
    const broken: VerificationQuotaStore = { consume: vi.fn().mockRejectedValue(new Error('redis down')) };
    const { svc } = service({ store: broken, limits: { anonymous: { perMinute: 1, perDay: 10 } } });
    expect((await svc.consume(anon, 1)).allowed).toBe(true);
    expect((await svc.consume(anon, 1)).allowed).toBe(false);
  });

  it('counts decisions per tier', async () => {
    const { svc } = service({ limits: { anonymous: { perMinute: 2, perDay: 10 } } });
    await svc.consume(anon, 2);
    await svc.consume(anon, 1);
    expect(svc.stats()).toEqual({ 'anonymous.allowed': 2, 'anonymous.exceeded_minute': 1 });
  });

  it('rejects non-positive costs', async () => {
    const { svc } = service();
    await expect(svc.consume(anon, 0)).rejects.toThrow(RangeError);
  });
});

describe('quota stores', () => {
  it('expires in-memory counters with their window', async () => {
    const store = new InMemoryVerificationQuotaStore();
    const counter = { key: 'k', limit: 1, ttlMs: 1_000 };
    expect((await store.consume([counter], 1, 0)).allowed).toBe(true);
    expect((await store.consume([counter], 1, 500)).allowed).toBe(false);
    expect((await store.consume([counter], 1, 1_000)).allowed).toBe(true);
  });

  it('sends one atomic script per request to Redis', async () => {
    const redis = { eval: vi.fn().mockResolvedValue([1, 4, 9]) };
    const store = new RedisVerificationQuotaStore(redis);
    const result = await store.consume(
      [
        { key: 'vq:a:m:1', limit: 5, ttlMs: 61_000 },
        { key: 'vq:a:d:1', limit: 50, ttlMs: 86_460_000 },
      ],
      2,
    );
    expect(result).toEqual({ allowed: true, counts: [4, 9] });
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval.mock.calls[0].slice(1)).toEqual([2, 'vq:a:m:1', 'vq:a:d:1', '2', '5', '61000', '50', '86460000']);
  });
});

describe('verificationQuota middleware', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  });

  async function start(svc: VerificationQuotaService) {
    const app = express();
    app.use(express.json());
    app.post('/verify', verificationQuota(() => 1, svc), (_req, res) => {
      res.json({ ok: true });
    });
    app.post(
      '/verify/batch',
      verificationQuota((req) => req.body.items.length, svc),
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    app.use((err: { statusCode?: number; code?: string; details?: unknown }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.statusCode ?? 500).json({ code: err.code, details: err.details });
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const address = server.address();
    return typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
  }

  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('sets quota headers and answers 429 with Retry-After once the agent is out of quota', async () => {
    const base = await start(new VerificationQuotaService({ now: () => NOW, limits: { anonymous: { perMinute: 2, perDay: 10 } } }));

    const first = await post(`${base}/verify`, {});
    expect(first.status).toBe(200);
    expect(first.headers.get('x-ratelimit-limit')).toBe('2');
    expect(first.headers.get('x-ratelimit-remaining')).toBe('1');
    expect(first.headers.get('x-verification-quota-day-remaining')).toBe('9');

    await post(`${base}/verify`, {});
    const denied = await post(`${base}/verify`, {});
    expect(denied.status).toBe(429);
    expect(denied.headers.get('retry-after')).toBe('30');
    expect(await denied.json()).toEqual({
      code: 'VERIFICATION_QUOTA_EXCEEDED',
      details: { window: 'minute', limit: 2, remaining: 0, retryAfterSeconds: 30 },
    });
  });

  it('gives each API key its own quota', async () => {
    const base = await start(new VerificationQuotaService({ now: () => NOW, limits: { anonymous: { perMinute: 1, perDay: 10 } } }));
    await post(`${base}/verify`, {});
    expect((await post(`${base}/verify`, {})).status).toBe(429);
    expect((await post(`${base}/verify`, {}, { 'x-api-key': FREE_KEY })).status).toBe(200);
  });

  it('answers 413 for a batch that can never fit', async () => {
    const base = await start(new VerificationQuotaService({ now: () => NOW }));
    const res = await post(`${base}/verify/batch`, { items: Array.from({ length: 6 }, () => ({})) });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'VERIFICATION_BATCH_TOO_LARGE', details: { cost: 6, limit: 5 } });
  });
});
