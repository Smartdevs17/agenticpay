/**
 * Token Bucket Rate Limiting Service with Tier-Based Limits
 * Issue #745: Implement rate limiting with token bucket algorithm and tier-based limits
 */

export type UserTier = 'free' | 'pro' | 'enterprise';

export interface TokenBucketConfig {
  /** Maximum tokens (burst capacity) */
  capacity: number;
  /** Tokens added per second */
  refillRate: number;
  /** Extra burst tokens allowed above capacity (one-time / initial bonus) */
  burstAllowance: number;
}

export interface EndpointConfig {
  free: TokenBucketConfig;
  pro: TokenBucketConfig;
  enterprise: TokenBucketConfig;
}

export interface RateLimitResult {
  allowed: boolean;
  tokensRemaining: number;
  capacity: number;
  retryAfterMs: number;
  resetSeconds: number;
}

export interface BucketState {
  tokens: number;
  lastRefillMs: number;
  burstUsed: boolean;
}

const HOUR_SECONDS = 3600;

export const DEFAULT_TIER_CONFIGS: Record<UserTier, TokenBucketConfig> = {
  free: { capacity: 1000, refillRate: 1000 / HOUR_SECONDS, burstAllowance: 100 },
  pro: { capacity: 10000, refillRate: 10000 / HOUR_SECONDS, burstAllowance: 1000 },
  enterprise: { capacity: 50000, refillRate: 50000 / HOUR_SECONDS, burstAllowance: 5000 },
};

export const SANDBOX_TIER_CONFIGS: Record<UserTier, TokenBucketConfig> = {
  free: { capacity: 1000, refillRate: 20, burstAllowance: 200 },
  pro: { capacity: 5000, refillRate: 100, burstAllowance: 1000 },
  enterprise: { capacity: 20000, refillRate: 400, burstAllowance: 4000 },
};

export interface RateLimitEvent {
  ts: number;
  key: string;
  tier: UserTier;
  endpoint: string;
  allowed: boolean;
  tokensRemaining: number;
}

export class RateLimitService {
  private buckets = new Map<string, BucketState>();
  private tierConfigs: Record<UserTier, TokenBucketConfig>;
  private endpointConfigs: Map<string, EndpointConfig> = new Map();
  private analytics: RateLimitEvent[] = [];
  private maxAnalyticsEvents = 5000;

  constructor(
    customTierConfigs?: Partial<Record<UserTier, TokenBucketConfig>>,
    sandboxMode = false,
  ) {
    const base = sandboxMode ? SANDBOX_TIER_CONFIGS : DEFAULT_TIER_CONFIGS;
    this.tierConfigs = { ...base, ...customTierConfigs };
  }

  public registerEndpointConfig(endpointPrefix: string, config: EndpointConfig): void {
    this.endpointConfigs.set(endpointPrefix, config);
  }

  public getTierConfig(tier: UserTier, endpoint?: string): TokenBucketConfig {
    if (endpoint) {
      for (const [prefix, config] of this.endpointConfigs.entries()) {
        if (endpoint.startsWith(prefix)) {
          return config[tier] || this.tierConfigs[tier];
        }
      }
    }
    return this.tierConfigs[tier] || this.tierConfigs.free;
  }

  public consume(
    key: string,
    tier: UserTier = 'free',
    cost = 1,
    endpoint?: string,
    nowMs: number = Date.now(),
  ): RateLimitResult {
    const config = this.getTierConfig(tier, endpoint);
    const maxCapacity = config.capacity + config.burstAllowance;

    let state = this.buckets.get(key);
    if (!state) {
      state = {
        tokens: maxCapacity,
        lastRefillMs: nowMs,
        burstUsed: false,
      };
    } else {
      // Refill tokens based on elapsed time
      const elapsedSeconds = Math.max(0, (nowMs - state.lastRefillMs) / 1000);
      state.tokens = Math.min(maxCapacity, state.tokens + elapsedSeconds * config.refillRate);
      state.lastRefillMs = nowMs;
    }

    let allowed = false;
    let retryAfterMs = 0;

    if (state.tokens >= cost) {
      state.tokens -= cost;
      allowed = true;
    } else {
      const tokensNeeded = cost - state.tokens;
      retryAfterMs = Math.ceil((tokensNeeded / config.refillRate) * 1000);
    }

    this.buckets.set(key, state);

    // Calculate reset in seconds (time until bucket is full)
    const tokensToFill = maxCapacity - state.tokens;
    const resetSeconds = Math.ceil(tokensToFill / config.refillRate);

    // Log analytics
    this.recordEvent({
      ts: nowMs,
      key,
      tier,
      endpoint: endpoint || 'global',
      allowed,
      tokensRemaining: Math.floor(state.tokens),
    });

    return {
      allowed,
      tokensRemaining: Math.floor(state.tokens),
      capacity: config.capacity,
      retryAfterMs,
      resetSeconds,
    };
  }

  public getRemaining(key: string, tier: UserTier = 'free', endpoint?: string, nowMs = Date.now()): number {
    const config = this.getTierConfig(tier, endpoint);
    const maxCapacity = config.capacity + config.burstAllowance;
    const state = this.buckets.get(key);
    if (!state) return maxCapacity;

    const elapsedSeconds = Math.max(0, (nowMs - state.lastRefillMs) / 1000);
    return Math.floor(Math.min(maxCapacity, state.tokens + elapsedSeconds * config.refillRate));
  }

  public reset(key: string): void {
    this.buckets.delete(key);
  }

  public clearAll(): void {
    this.buckets.clear();
    this.analytics = [];
  }

  public recordEvent(event: RateLimitEvent): void {
    this.analytics.push(event);
    if (this.analytics.length > this.maxAnalyticsEvents) {
      this.analytics.shift();
    }
  }

  public getAnalytics(windowMs = 60_000, nowMs = Date.now()) {
    const cutoff = nowMs - windowMs;
    const recent = this.analytics.filter((e) => e.ts >= cutoff);
    const blocked = recent.filter((e) => !e.allowed);

    const byTier: Record<string, { total: number; blocked: number }> = {};
    const byEndpoint: Record<string, { total: number; blocked: number }> = {};

    for (const e of recent) {
      byTier[e.tier] ??= { total: 0, blocked: 0 };
      byTier[e.tier].total++;
      if (!e.allowed) byTier[e.tier].blocked++;

      byEndpoint[e.endpoint] ??= { total: 0, blocked: 0 };
      byEndpoint[e.endpoint].total++;
      if (!e.allowed) byEndpoint[e.endpoint].blocked++;
    }

    return {
      windowMs,
      total: recent.length,
      blocked: blocked.length,
      allowRate: recent.length ? (recent.length - blocked.length) / recent.length : 1,
      byTier,
      byEndpoint,
    };
  }
}

export const defaultRateLimitService = new RateLimitService();
