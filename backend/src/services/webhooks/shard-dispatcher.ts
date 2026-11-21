/**
 * Domain-sharded webhook dispatch (#1462).
 *
 * The delivery worker used to send every due webhook one at a time in a
 * single global pass, and skipped whole ticks while a pass was running. One
 * slow or hanging endpoint (up to the per-attempt timeout) therefore delayed
 * every other merchant's deliveries: head-of-line blocking that showed up as
 * tail latency for everyone.
 *
 * Due deliveries are now grouped by destination host ("shard"). Each shard
 * drains on its own lane:
 *
 *   - Within a shard, deliveries run one at a time, oldest first, so a
 *     merchant's endpoint never sees more than one concurrent request from us.
 *   - Different shards run concurrently, up to `maxConcurrentShards`.
 *   - A shard still draining is skipped on later ticks rather than started
 *     twice, so a delivery is never in flight twice. Other shards keep
 *     flowing, so a slow host only delays its own deliveries.
 *   - A shard drains at most `maxBatchPerShard` deliveries per run, so a large
 *     backlog for one host yields its lane instead of monopolising it.
 *
 * The dispatcher is generic over the delivery type so it can be tested
 * without the HTTP layer; `services/webhooks.ts` wires it to real deliveries.
 */

export interface ShardDispatcherOptions {
  /** Shards (destination hosts) that may drain at the same time. */
  maxConcurrentShards: number;
  /** Deliveries a shard drains per run before giving its lane back. */
  maxBatchPerShard: number;
}

export const DEFAULT_SHARD_DISPATCHER_OPTIONS: ShardDispatcherOptions = {
  maxConcurrentShards: 8,
  maxBatchPerShard: 25,
};

const LIMITS = {
  maxConcurrentShards: { min: 1, max: 256 },
  maxBatchPerShard: { min: 1, max: 1_000 },
} as const;

/**
 * Reads `WEBHOOK_DISPATCH_MAX_CONCURRENT_SHARDS` and
 * `WEBHOOK_DISPATCH_MAX_BATCH_PER_SHARD`. A missing value uses the default;
 * an invalid one (not an integer, or out of range) throws so a typo surfaces
 * at startup instead of silently changing throughput.
 */
export function readShardDispatcherOptions(env: NodeJS.ProcessEnv = process.env): ShardDispatcherOptions {
  const read = (name: string, key: keyof ShardDispatcherOptions): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') return DEFAULT_SHARD_DISPATCHER_OPTIONS[key];
    const value = Number(raw);
    const { min, max } = LIMITS[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
    }
    return value;
  };
  return {
    maxConcurrentShards: read('WEBHOOK_DISPATCH_MAX_CONCURRENT_SHARDS', 'maxConcurrentShards'),
    maxBatchPerShard: read('WEBHOOK_DISPATCH_MAX_BATCH_PER_SHARD', 'maxBatchPerShard'),
  };
}

/** Shard for deliveries whose URL cannot be parsed; they still drain, just together. */
export const UNPARSEABLE_URL_SHARD = 'invalid-url';

/**
 * The shard a webhook URL belongs to: its lowercased host without a trailing
 * dot or IPv6 brackets. The port is ignored, so `api.example.com:8443` and
 * `api.example.com` share a lane, because they are usually the same server.
 */
export function shardKeyForUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
    return host || UNPARSEABLE_URL_SHARD;
  } catch {
    return UNPARSEABLE_URL_SHARD;
  }
}

/** Percentiles over the most recent samples of a duration, in ms. */
export interface LatencySummary {
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface DispatchStatsSnapshot {
  /** Shards (destination hosts) draining right now. */
  activeShards: number;
  /** Due deliveries seen by the most recent pass. */
  dueBacklog: number;
  passes: number;
  shardRuns: number;
  deliveriesStarted: number;
  /** Times a pass found a shard still draining and left it alone. */
  busyShardSkips: number;
  /** Times a shard had to wait because `maxConcurrentShards` lanes were busy. */
  deferredShards: number;
  /** deliver() calls that threw (outcomes are normally recorded by deliver itself). */
  deliverErrors: number;
  /** Time from a delivery becoming due to its send starting: the tail-latency signal. */
  queueWaitMs: LatencySummary;
  /** Wall time of one shard run. */
  shardRunMs: LatencySummary;
}

/** Recent-window size for latency percentiles. */
const LATENCY_WINDOW = 1_024;

class LatencyWindow {
  private readonly values: number[] = [];
  private next = 0;

  record(value: number): void {
    if (this.values.length < LATENCY_WINDOW) this.values.push(value);
    else this.values[this.next] = value;
    this.next = (this.next + 1) % LATENCY_WINDOW;
  }

  summary(): LatencySummary {
    if (this.values.length === 0) return { samples: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const sorted = [...this.values].sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
    return { samples: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1] };
  }
}

export interface DispatchLogger {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface ShardDispatcherDeps<T> {
  /** Shard (destination host) of a delivery. */
  shardKey(item: T): string;
  /** When the delivery became due, in epoch ms, to measure queue wait. */
  dueAt(item: T): number | undefined;
  /** Delivers one item. Expected to record its own outcome; a throw is logged and the shard moves on. */
  deliver(item: T): Promise<void>;
  logger?: DispatchLogger;
  now?: () => number;
}

/** At most one saturation warning per this interval, so a busy minute logs once. */
const SATURATION_WARN_INTERVAL_MS = 60_000;

export interface DispatchPassResult {
  /** Due deliveries handed to this pass. */
  due: number;
  /** Shards that had due deliveries. */
  shards: number;
  /** Shards started by this pass. */
  started: number;
  /** Shards skipped because they were still draining from an earlier pass. */
  busy: number;
  /** Shards left for a later tick because the concurrency cap was reached. */
  deferred: number;
  /** Resolves once every shard started by this pass has finished its run. */
  settled: Promise<void>;
}

export class ShardedDispatcher<T> {
  private readonly active = new Map<string, Promise<void>>();
  private readonly now: () => number;
  private readonly counters = {
    dueBacklog: 0,
    passes: 0,
    shardRuns: 0,
    deliveriesStarted: 0,
    busyShardSkips: 0,
    deferredShards: 0,
    deliverErrors: 0,
  };
  private readonly queueWait = new LatencyWindow();
  private readonly shardRun = new LatencyWindow();
  private lastSaturationWarnAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly options: ShardDispatcherOptions,
    private readonly deps: ShardDispatcherDeps<T>,
  ) {
    this.now = deps.now ?? Date.now;
  }

  /** Shards currently draining. */
  activeShards(): string[] {
    return [...this.active.keys()];
  }

  /** Counters and latency percentiles since this dispatcher was created. */
  stats(): DispatchStatsSnapshot {
    return {
      activeShards: this.active.size,
      ...this.counters,
      queueWaitMs: this.queueWait.summary(),
      shardRunMs: this.shardRun.summary(),
    };
  }

  /** Resolves once every shard that is currently draining has finished. */
  async idle(): Promise<void> {
    while (this.active.size > 0) {
      await Promise.all(this.active.values());
    }
  }

  /**
   * Starts a run for every idle shard with due deliveries, oldest shard
   * first, until the concurrency cap is reached. Never waits for deliveries;
   * use `settled` (or `idle()`) to wait for the started runs.
   */
  dispatch(due: readonly T[]): DispatchPassResult {
    const groups = new Map<string, T[]>();
    for (const item of due) {
      const key = this.deps.shardKey(item);
      const group = groups.get(key);
      if (group) group.push(item);
      else groups.set(key, [item]);
    }

    // Oldest-due shard first, so a lane freed by the cap goes to the shard
    // that has been waiting longest.
    const ordered = [...groups.entries()]
      .map(([key, items]) => {
        const sorted = [...items].sort((a, b) => (this.deps.dueAt(a) ?? 0) - (this.deps.dueAt(b) ?? 0));
        return { key, items: sorted, oldest: this.deps.dueAt(sorted[0]) ?? 0 };
      })
      .sort((a, b) => a.oldest - b.oldest);

    let started = 0;
    let busy = 0;
    let deferred = 0;
    const runs: Promise<void>[] = [];
    for (const { key, items } of ordered) {
      if (this.active.has(key)) {
        busy += 1;
        continue;
      }
      if (this.active.size >= this.options.maxConcurrentShards) {
        deferred += 1;
        continue;
      }
      const run = this.runShard(key, items.slice(0, this.options.maxBatchPerShard));
      this.active.set(key, run);
      runs.push(run);
      started += 1;
    }

    this.counters.passes += 1;
    this.counters.dueBacklog = due.length;
    this.counters.busyShardSkips += busy;
    this.counters.deferredShards += deferred;
    if (deferred > 0) this.warnSaturated(deferred);

    return {
      due: due.length,
      shards: groups.size,
      started,
      busy,
      deferred,
      settled: Promise.all(runs).then(() => undefined),
    };
  }

  private warnSaturated(deferred: number): void {
    const now = this.now();
    if (now - this.lastSaturationWarnAt < SATURATION_WARN_INTERVAL_MS) return;
    this.lastSaturationWarnAt = now;
    this.deps.logger?.warn('webhook dispatch saturated: shards are waiting for a free lane', {
      deferredShards: deferred,
      activeShards: this.active.size,
      maxConcurrentShards: this.options.maxConcurrentShards,
      hint: 'raise WEBHOOK_DISPATCH_MAX_CONCURRENT_SHARDS if this persists',
    });
  }

  private async runShard(key: string, items: T[]): Promise<void> {
    const startedAt = this.now();
    this.counters.shardRuns += 1;
    try {
      for (const item of items) {
        const dueAt = this.deps.dueAt(item);
        if (dueAt !== undefined) this.queueWait.record(Math.max(0, this.now() - dueAt));
        this.counters.deliveriesStarted += 1;
        try {
          await this.deps.deliver(item);
        } catch (err) {
          // deliver() records outcomes itself; a throw here is a bug in that
          // path. Keep draining the shard so one bad delivery cannot stall it.
          this.counters.deliverErrors += 1;
          this.deps.logger?.error('webhook shard delivery threw', {
            shard: key,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      this.active.delete(key);
      this.shardRun.record(this.now() - startedAt);
    }
  }
}
