/**
 * read-replica-router.ts — Issue #947
 *
 * Read replica load balancer with pluggable selection strategies:
 *   - round_robin   — equal distribution across healthy replicas (default)
 *   - weighted      — traffic split by configured replica weights
 *   - least_connections — route to the replica with fewest active queries
 *
 * Includes health tracking, failover cooldown, replication-lag gating,
 * session stickiness, and disable/enable for operations.
 */

export type LoadBalancingStrategy = 'round_robin' | 'weighted' | 'least_connections';

export type ReplicaHealth = 'healthy' | 'unhealthy' | 'lagging';

export interface ReplicaSnapshot {
  url: string;
  health: ReplicaHealth;
  lagMs: number;
  failureCount: number;
  disabled: boolean;
  cooldownUntil: number;
  activeConnections: number;
  weight: number;
  lastCheck: number;
}

export interface ReadReplicaRouterOptions {
  /** Time (ms) a replica stays in cooldown after a failure before being probed again. */
  failoverCooldownMs?: number;
  /** Pin reads from the same session to one replica. */
  enableStickiness?: boolean;
  /** Custom lag probe (returns replication lag in ms). */
  lagProbe?: (url: string) => Promise<number>;
  /** Load balancing strategy: round_robin | weighted | least_connections. */
  loadBalancingStrategy?: LoadBalancingStrategy;
  /** Per-replica weights (used by the weighted strategy). */
  weights?: Record<string, number>;
}

interface ReplicaState {
  url: string;
  health: ReplicaHealth;
  lagMs: number;
  failureCount: number;
  disabled: boolean;
  cooldownUntil: number;
  activeConnections: number;
  weight: number;
  lastCheck: number;
}

/**
 * Routes read queries to replicas and writes to primary, with pluggable
 * load balancing strategies for distributing read traffic.
 */
export class ReadReplicaRouter {
  private readonly primary: string;
  private readonly maxLagMs: number;
  private readonly options: Required<ReadReplicaRouterOptions>;
  private readonly replicas = new Map<string, ReplicaState>();
  private roundRobinIndex = 0;
  private sessionStickiness = new Map<string, string>(); // sessionId -> url
  private healthCheckTimer?: ReturnType<typeof setInterval>;
  private healthChecking = false;

  constructor(
    replicaUrls: string[],
    primaryUrl: string,
    maxLagMs: number,
    options: ReadReplicaRouterOptions = {},
  ) {
    this.primary = primaryUrl;
    this.maxLagMs = maxLagMs;
    this.options = {
      failoverCooldownMs: options.failoverCooldownMs ?? 60_000,
      enableStickiness: options.enableStickiness ?? false,
      lagProbe: options.lagProbe,
      loadBalancingStrategy: options.loadBalancingStrategy ?? 'round_robin',
      weights: options.weights ?? {},
    };

    for (const url of replicaUrls) {
      this.replicas.set(url, {
        url,
        health: 'healthy',
        lagMs: 0,
        failureCount: 0,
        disabled: false,
        cooldownUntil: 0,
        activeConnections: 0,
        weight: this.options.weights[url] ?? 1,
        lastCheck: Date.now(),
      });
    }
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  select(sql: string, sessionId?: string): {
    url: string;
    source: 'primary' | 'replica';
    reason: string;
  } {
    const isRead = /^\s*(SELECT|WITH\s)/i.test(sql);

    // Writes always go to primary.
    if (!isRead) {
      return { url: this.primary, source: 'primary', reason: 'write_query' };
    }

    const healthy = this.getHealthyReplicas();
    if (healthy.length === 0) {
      return { url: this.primary, source: 'primary', reason: 'replica_unavailable' };
    }

    // Session stickiness: pin to the previously selected replica if still usable.
    if (sessionId && this.options.enableStickiness) {
      const sticky = this.sessionStickiness.get(sessionId);
      if (sticky && healthy.some((r) => r.url === sticky)) {
        this.incrementActive(sticky);
        return { url: sticky, source: 'replica', reason: 'sticky_session' };
      }
    }

    const selected = this.selectReplica(healthy);

    if (sessionId && this.options.enableStickiness) {
      this.sessionStickiness.set(sessionId, selected.url);
    }

    this.incrementActive(selected.url);
    return { url: selected.url, source: 'replica', reason: 'healthy_replica' };
  }

  private selectReplica(candidates: ReplicaState[]): ReplicaState {
    switch (this.options.loadBalancingStrategy) {
      case 'weighted':
        return this.selectWeighted(candidates);
      case 'least_connections':
        return this.selectLeastConnections(candidates);
      case 'round_robin':
      default:
        return this.selectRoundRobin(candidates);
    }
  }

  private selectRoundRobin(candidates: ReplicaState[]): ReplicaState {
    const replica = candidates[this.roundRobinIndex % candidates.length];
    this.roundRobinIndex++;
    return replica;
  }

  private selectWeighted(candidates: ReplicaState[]): ReplicaState {
    const totalWeight = candidates.reduce((sum, r) => sum + r.weight, 0);
    let random = Math.random() * totalWeight;
    for (const replica of candidates) {
      random -= replica.weight;
      if (random <= 0) return replica;
    }
    return candidates[candidates.length - 1];
  }

  private selectLeastConnections(candidates: ReplicaState[]): ReplicaState {
    return candidates.reduce((best, current) =>
      current.activeConnections < best.activeConnections ? current : best,
    );
  }

  private getHealthyReplicas(): ReplicaState[] {
    const now = Date.now();
    return Array.from(this.replicas.values()).filter((r) => {
      if (r.disabled) return false;
      if (r.cooldownUntil > now) return false;
      if (r.health === 'unhealthy') return false;
      if (r.health === 'lagging' && r.lagMs > this.maxLagMs) return false;
      return true;
    });
  }

  private incrementActive(url: string): void {
    const r = this.replicas.get(url);
    if (r) r.activeConnections++;
  }

  private decrementActive(url: string): void {
    const r = this.replicas.get(url);
    if (r && r.activeConnections > 0) r.activeConnections--;
  }

  // ── Health management ────────────────────────────────────────────────────

  updateHealth(url: string, health: { healthy: boolean; lagMs?: number }): void {
    const r = this.replicas.get(url);
    if (!r) return;

    const now = Date.now();
    r.lastCheck = now;

    if (!health.healthy) {
      r.health = 'unhealthy';
      r.failureCount++;
      r.cooldownUntil = now + this.options.failoverCooldownMs;
    } else {
      r.health = health.lagMs != null && health.lagMs > this.maxLagMs ? 'lagging' : 'healthy';
      r.lagMs = health.lagMs ?? 0;
      if (r.health === 'healthy') {
        r.failureCount = 0;
        r.cooldownUntil = 0;
      }
    }
  }

  snapshot(): ReplicaSnapshot[] {
    return Array.from(this.replicas.values()).map((r) => ({
      url: r.url,
      health: r.health,
      lagMs: r.lagMs,
      failureCount: r.failureCount,
      disabled: r.disabled,
      cooldownUntil: r.cooldownUntil,
      activeConnections: r.activeConnections,
      weight: r.weight,
      lastCheck: r.lastCheck,
    }));
  }

  disableReplica(url: string): void {
    const r = this.replicas.get(url);
    if (r) {
      r.disabled = true;
      r.failureCount = 0;
      r.cooldownUntil = 0;
    }
  }

  enableReplica(url: string): void {
    const r = this.replicas.get(url);
    if (r) {
      r.disabled = false;
      r.failureCount = 0;
      r.cooldownUntil = 0;
      r.health = 'healthy';
    }
  }

  stickySessions(): Map<string, string> {
    return new Map(this.sessionStickiness);
  }

  // ── Background health checks ────────────────────────────────────────────

  startHealthChecks(intervalMs = 30_000): void {
    if (this.healthCheckTimer) return;
    this.healthCheckTimer = setInterval(() => {
      void this.runHealthCheckCycle();
    }, intervalMs);
    this.healthCheckTimer.unref?.();
  }

  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  async runHealthCheckCycle(): Promise<void> {
    if (this.healthChecking || !this.options.lagProbe) return;
    this.healthChecking = true;
    try {
      for (const [url, state] of this.replicas.entries()) {
        if (state.disabled) continue;
        try {
          const lag = await this.options.lagProbe(url);
          const healthy = lag < this.maxLagMs;
          this.updateHealth(url, { healthy, lagMs: lag });
        } catch {
          this.updateHealth(url, { healthy: false });
        }
      }
    } finally {
      this.healthChecking = false;
    }
  }
}

/** Build replica URL strings from the DB_READ_REPLICA_URLS env var. */
export function buildReplicaUrls(): string[] {
  return (process.env.DB_READ_REPLICA_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Singleton router instance (lazily initialised). */
let _router: ReadReplicaRouter | null = null;

export function getReadReplicaRouter(
  replicaUrls?: string[],
  primaryUrl?: string,
  maxLagMs?: number,
  options?: ReadReplicaRouterOptions,
): ReadReplicaRouter {
  if (!_router) {
    _router = new ReadReplicaRouter(
      replicaUrls ?? buildReplicaUrls(),
      primaryUrl ?? process.env.DATABASE_URL ?? 'postgres://primary/db',
      maxLagMs ?? 5000,
      options,
    );
  }
  return _router;
}

export function resetReadReplicaRouterForTesting(): void {
  _router = null;
}
