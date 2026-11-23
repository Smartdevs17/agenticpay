import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import OpenAI from 'openai';
import { getSharedRateLimitRedis } from '../config/rate-limit-redis.js';
import { AppError } from '../middleware/errorHandler.js';
import { createModuleLogger } from '../middleware/logger.js';
import { lookupApiKey } from './api-key-registry.js';
import { config } from '../config/env.js';

let openaiClient: OpenAI | null = null;

const getOpenAIClient = () => {
  const apiKey = config().OPENAI_API_KEY;

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
};

interface VerificationRequest {
  repositoryUrl: string;
  milestoneDescription: string;
  projectId: string;
}

interface VerificationResult {
  id: string;
  projectId: string;
  status: 'passed' | 'failed' | 'pending';
  score: number;
  summary: string;
  details: string[];
  verifiedAt: string;
}

export type VerificationUpdate = {
  id: string;
  status?: 'passed' | 'failed' | 'pending';
  score?: number;
  summary?: string;
  details?: string[];
};

import { withQueryProfiling } from '../config/database.js';

// In-memory store (replace with DB in production)
const verifications = new Map<string, VerificationResult>();

export async function verifyWork(request: VerificationRequest): Promise<VerificationResult> {
  const id = `ver_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // TODO: Fetch actual repo contents via GitHub API
  // For now, use AI to generate a verification assessment

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are a code reviewer. Given a milestone description and repository URL, assess whether the work likely meets the requirements. Respond with a JSON object containing: score (0-100), summary (one sentence), details (array of specific observations).',
      },
      {
        role: 'user',
        content: `Repository: ${request.repositoryUrl}\nMilestone: ${request.milestoneDescription}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const assessment = JSON.parse(completion.choices[0].message.content || '{}');

  const result: VerificationResult = {
    id,
    projectId: request.projectId,
    status: (assessment.score || 0) >= 70 ? 'passed' : 'failed',
    score: assessment.score || 0,
    summary: assessment.summary || 'Verification completed',
    details: assessment.details || [],
    verifiedAt: new Date().toISOString(),
  };

  storeVerification(result);
  return result;
}

export function storeVerification(result: VerificationResult): void {
  verifications.set(result.id, result);
}

export async function getVerification(id: string): Promise<VerificationResult | undefined> {
  return withQueryProfiling(
    'SELECT * FROM verifications WHERE id = ?',
    'verification.service',
    async () => verifications.get(id),
  );
}

export function updateVerification(update: VerificationUpdate): VerificationResult | undefined {
  const current = verifications.get(update.id);
  if (!current) {
    return undefined;
  }

  const updated: VerificationResult = {
    ...current,
    status: update.status ?? current.status,
    score: update.score ?? current.score,
    summary: update.summary ?? current.summary,
    details: update.details ?? current.details,
    verifiedAt: new Date().toISOString(),
  };

  verifications.set(update.id, updated);
  return updated;
}

export function deleteVerification(id: string): boolean {
  return verifications.delete(id);
}

// ── Per-agent verification quotas (#1480) ─────────────────────────────────────
//
// Every verification runs a paid model call, so each calling agent gets a
// short burst limit (per minute) and a daily quota, both counted in
// verifications: a batch of 20 items costs 20. A request is admitted only if
// it fits in every window, and then it is charged against all of them at
// once, so a rejected request never consumes quota.
//
// Agents are identified only from credentials the server can check: an API
// key from the registry, or an authenticated principal (`req.user`).
// Everyone else is an anonymous agent keyed by client IP with the smallest
// quota. Caller-supplied hints such as `X-User-Tier` or `X-Agent-Id` are
// ignored, so they cannot be rotated to mint fresh quota.

export type VerificationAgentTier = 'anonymous' | 'free' | 'pro' | 'enterprise';

export interface VerificationQuotaLimits {
  /** Verifications per clock minute. */
  perMinute: number;
  /** Verifications per UTC day. */
  perDay: number;
}

export const DEFAULT_VERIFICATION_QUOTAS: Record<VerificationAgentTier, VerificationQuotaLimits> = {
  anonymous: { perMinute: 5, perDay: 50 },
  free: { perMinute: 10, perDay: 200 },
  pro: { perMinute: 60, perDay: 5_000 },
  enterprise: { perMinute: 300, perDay: 50_000 },
};

export interface VerificationAgent {
  /** Stable quota key, never a raw credential. */
  id: string;
  tier: VerificationAgentTier;
}

export type QuotaWindowName = 'minute' | 'day';

export interface QuotaWindowState {
  window: QuotaWindowName;
  limit: number;
  used: number;
  remaining: number;
  /** Epoch ms at which this window resets. */
  resetAt: number;
}

export interface VerificationQuotaDecision {
  allowed: boolean;
  agent: VerificationAgent;
  cost: number;
  windows: QuotaWindowState[];
  /** The window that rejected the request, if any. */
  exceeded?: QuotaWindowName;
  /** True when `cost` exceeds a window's whole limit, so waiting will not help. */
  tooLarge?: boolean;
  retryAfterMs?: number;
}

/** A counter slot for one agent in one window. */
export interface QuotaCounter {
  key: string;
  limit: number;
  ttlMs: number;
}

/**
 * Atomic check-and-charge across several counters: either every counter has
 * room for `cost` and all are incremented, or none is. Returns the counts
 * after the call (unchanged when rejected).
 */
export interface VerificationQuotaStore {
  consume(counters: QuotaCounter[], cost: number, nowMs: number): Promise<{ allowed: boolean; counts: number[] }>;
}

export class InMemoryVerificationQuotaStore implements VerificationQuotaStore {
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();

  async consume(counters: QuotaCounter[], cost: number, nowMs: number) {
    const counts = counters.map((c) => this.read(c.key, nowMs));
    const allowed = counters.every((c, i) => counts[i] + cost <= c.limit);
    if (!allowed) return { allowed, counts };
    counters.forEach((c, i) => {
      const existing = this.counters.get(c.key);
      const expiresAt = existing && existing.expiresAt > nowMs ? existing.expiresAt : nowMs + c.ttlMs;
      this.counters.set(c.key, { count: counts[i] + cost, expiresAt });
      counts[i] += cost;
    });
    if (this.counters.size > 10_000) this.sweep(nowMs);
    return { allowed, counts };
  }

  private read(key: string, nowMs: number): number {
    const entry = this.counters.get(key);
    if (!entry || entry.expiresAt <= nowMs) return 0;
    return entry.count;
  }

  private sweep(nowMs: number): void {
    for (const [key, entry] of this.counters) {
      if (entry.expiresAt <= nowMs) this.counters.delete(key);
    }
  }
}

/** ioredis-compatible subset used by the Redis store. */
export interface VerificationQuotaRedis {
  eval(script: string, numkeys: number, ...args: string[]): Promise<unknown>;
}

// KEYS = counters; ARGV = cost, then limit and ttl per counter.
const CONSUME_SCRIPT = `
local cost = tonumber(ARGV[1])
local counts = {}
for i, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[i * 2])
  local used = tonumber(redis.call('GET', key) or '0')
  counts[i] = used
  if used + cost > limit then
    return {0, unpack(counts)}
  end
end
for i, key in ipairs(KEYS) do
  local ttl = tonumber(ARGV[i * 2 + 1])
  counts[i] = redis.call('INCRBY', key, cost)
  if redis.call('PTTL', key) < 0 then
    redis.call('PEXPIRE', key, ttl)
  end
end
return {1, unpack(counts)}
`;

/** Shared counters for multi-instance deployments; one round trip per request. */
export class RedisVerificationQuotaStore implements VerificationQuotaStore {
  constructor(private readonly redis: VerificationQuotaRedis) {}

  async consume(counters: QuotaCounter[], cost: number) {
    const args = [String(cost), ...counters.flatMap((c) => [String(c.limit), String(c.ttlMs)])];
    const reply = (await this.redis.eval(CONSUME_SCRIPT, counters.length, ...counters.map((c) => c.key), ...args)) as number[];
    const [allowed, ...counts] = reply.map(Number);
    // The script stops reading at the first full counter; unread ones are reported as 0.
    return { allowed: allowed === 1, counts: counters.map((_, i) => counts[i] ?? 0) };
  }
}

export interface VerificationQuotaOptions {
  limits?: Partial<Record<VerificationAgentTier, VerificationQuotaLimits>>;
  /** Per-agent overrides keyed by `VerificationAgent.id`. */
  overrides?: Record<string, Partial<VerificationQuotaLimits>>;
  store?: VerificationQuotaStore;
  now?: () => number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export class VerificationQuotaService {
  private readonly limits: Record<VerificationAgentTier, VerificationQuotaLimits>;
  private readonly overrides: Map<string, Partial<VerificationQuotaLimits>>;
  private store: VerificationQuotaStore;
  private readonly fallback = new InMemoryVerificationQuotaStore();
  private readonly now: () => number;
  private readonly counters = new Map<string, number>();

  constructor(options: VerificationQuotaOptions = {}) {
    this.limits = { ...DEFAULT_VERIFICATION_QUOTAS, ...options.limits };
    this.overrides = new Map(Object.entries(options.overrides ?? {}));
    this.store = options.store ?? this.fallback;
    this.now = options.now ?? Date.now;
  }

  useStore(store: VerificationQuotaStore): void {
    this.store = store;
  }

  setOverride(agentId: string, limits: Partial<VerificationQuotaLimits>): void {
    this.overrides.set(agentId, limits);
  }

  removeOverride(agentId: string): boolean {
    return this.overrides.delete(agentId);
  }

  limitsFor(agent: VerificationAgent): VerificationQuotaLimits {
    return { ...this.limits[agent.tier], ...this.overrides.get(agent.id) };
  }

  /** Check `cost` verifications against every window and charge them if they fit. */
  async consume(agent: VerificationAgent, cost: number): Promise<VerificationQuotaDecision> {
    if (!Number.isInteger(cost) || cost < 1) throw new RangeError('verification cost must be a positive integer');

    const nowMs = this.now();
    const limits = this.limitsFor(agent);
    const minuteStart = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
    const dayStart = Math.floor(nowMs / DAY_MS) * DAY_MS;
    const windows: Array<{ window: QuotaWindowName; limit: number; resetAt: number; counter: QuotaCounter }> = [
      {
        window: 'minute',
        limit: limits.perMinute,
        resetAt: minuteStart + MINUTE_MS,
        counter: { key: `vq:${agent.id}:m:${minuteStart}`, limit: limits.perMinute, ttlMs: MINUTE_MS + 1_000 },
      },
      {
        window: 'day',
        limit: limits.perDay,
        resetAt: dayStart + DAY_MS,
        counter: { key: `vq:${agent.id}:d:${dayStart}`, limit: limits.perDay, ttlMs: DAY_MS + 60_000 },
      },
    ];

    const tooLargeFor = windows.find((w) => cost > w.limit);
    if (tooLargeFor) {
      this.observe(agent.tier, 'too_large');
      return {
        allowed: false,
        agent,
        cost,
        exceeded: tooLargeFor.window,
        tooLarge: true,
        windows: windows.map((w) => ({ window: w.window, limit: w.limit, used: 0, remaining: w.limit, resetAt: w.resetAt })),
      };
    }

    let result: { allowed: boolean; counts: number[] };
    try {
      result = await this.store.consume(windows.map((w) => w.counter), cost, nowMs);
    } catch (error) {
      // A shared store outage must not switch quotas off; keep enforcing per instance.
      quotaLog.error({ err: error }, 'Verification quota store unavailable; using in-memory counters');
      result = await this.fallback.consume(windows.map((w) => w.counter), cost, nowMs);
    }

    const states: QuotaWindowState[] = windows.map((w, i) => {
      const used = result.counts[i] ?? 0;
      return { window: w.window, limit: w.limit, used, remaining: Math.max(0, w.limit - used), resetAt: w.resetAt };
    });

    if (result.allowed) {
      this.observe(agent.tier, 'allowed', cost);
      return { allowed: true, agent, cost, windows: states };
    }

    const blocking = states.filter((s) => s.used + cost > s.limit);
    // Waiting for the latest blocking window to reset is enough for all of them.
    const binding = blocking.reduce((a, b) => (b.resetAt > a.resetAt ? b : a), blocking[0] ?? states[0]);
    this.observe(agent.tier, `exceeded_${binding.window}`);
    quotaLog.warn(
      { agent: agent.id, tier: agent.tier, window: binding.window, limit: binding.limit, used: binding.used, cost },
      'Verification quota exceeded',
    );
    return {
      allowed: false,
      agent,
      cost,
      windows: states,
      exceeded: binding.window,
      retryAfterMs: Math.max(0, binding.resetAt - nowMs),
    };
  }

  /** Decision counters since start-up, keyed `tier.outcome`. */
  stats(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  private observe(tier: VerificationAgentTier, outcome: string, amount = 1): void {
    const key = `${tier}.${outcome}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }
}

const quotaLog = createModuleLogger('verification-quota');

function hashCredential(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

/** Who is calling, from verifiable credentials only. */
export function resolveVerificationAgent(req: Request): VerificationAgent {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim()) {
    const record = lookupApiKey(apiKey);
    if (record) return { id: `key:${hashCredential(record.key)}`, tier: record.tier };
  }

  if (req.user) {
    const tier = (['free', 'pro', 'enterprise'] as const).find((t) => t === req.user?.role) ?? 'free';
    return { id: `principal:${req.user.tenantId}:${req.user.id}`, tier };
  }

  // Behind the edge worker the socket peer is the worker; a verified worker
  // token may report the end-user's IP instead (#1474).
  const ip = req.service?.clientIp ?? req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  return { id: `ip:${ip}`, tier: 'anonymous' };
}

export const verificationQuotaService = new VerificationQuotaService();

let sharedStoreAttached = false;

/** Use Redis-backed counters when `REDIS_URL` is configured (once per process). */
function attachSharedStore(): void {
  if (sharedStoreAttached) return;
  sharedStoreAttached = true;
  void getSharedRateLimitRedis().then((redis) => {
    if (redis) verificationQuotaService.useStore(new RedisVerificationQuotaStore(redis));
  });
}

function setQuotaHeaders(res: Response, decision: VerificationQuotaDecision): void {
  const binding =
    decision.windows.find((w) => w.window === decision.exceeded) ??
    decision.windows.reduce((a, b) => (b.remaining < a.remaining ? b : a));
  res.setHeader('X-RateLimit-Limit', String(binding.limit));
  res.setHeader('X-RateLimit-Remaining', String(binding.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(binding.resetAt / 1000)));
  for (const w of decision.windows) {
    const name = w.window === 'minute' ? 'Minute' : 'Day';
    res.setHeader(`X-Verification-Quota-${name}-Remaining`, String(w.remaining));
  }
}

/**
 * Express middleware enforcing per-agent verification quotas. `cost` returns
 * how many verifications the request will run (1 for `/verify`, the item
 * count for `/verify/batch`); mount it after body validation.
 */
export function verificationQuota(
  cost: (req: Request) => number = () => 1,
  service: VerificationQuotaService = verificationQuotaService,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (service === verificationQuotaService) attachSharedStore();
      const agent = resolveVerificationAgent(req);
      const decision = await service.consume(agent, Math.max(1, cost(req)));
      setQuotaHeaders(res, decision);

      if (decision.allowed) return next();

      const binding = decision.windows.find((w) => w.window === decision.exceeded)!;
      if (decision.tooLarge) {
        return next(
          new AppError(413, `Request needs ${decision.cost} verifications but the ${binding.window} quota is ${binding.limit}`, 'VERIFICATION_BATCH_TOO_LARGE', {
            cost: decision.cost,
            window: binding.window,
            limit: binding.limit,
          }),
        );
      }

      const retryAfterSeconds = Math.ceil((decision.retryAfterMs ?? 0) / 1000);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return next(
        new AppError(429, `Verification quota exceeded for this ${binding.window}`, 'VERIFICATION_QUOTA_EXCEEDED', {
          window: binding.window,
          limit: binding.limit,
          remaining: binding.remaining,
          retryAfterSeconds,
        }),
      );
    } catch (error) {
      next(error);
    }
  };
}
