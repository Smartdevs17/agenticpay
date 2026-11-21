/**
 * Payout anomaly detection — Issue #1013
 *
 * Flags payouts that are unusually large or arrive unusually fast. Every rule threshold
 * is configurable (constructor, environment, or `updateConfig` at runtime), every flag
 * emits an alert to the configured sinks, and every flag enters a review queue where an
 * operator either confirms it or marks it a false positive.
 *
 * Rules (all evaluated against the merchant's own history):
 * - `single_amount`      — one payout at or above `singlePayoutThreshold`
 * - `velocity_count`     — more than `velocityMaxCount` payouts inside `velocityWindowMs`
 * - `velocity_amount`    — more than `velocityMaxAmount` paid out inside `velocityWindowMs`
 * - `baseline_deviation` — a payout more than `baselineMultiplier` x the merchant's
 *                          rolling average (once `baselineMinSamples` payouts exist)
 *
 * A false-positive decision can suppress the same rule for that merchant for a while, so
 * a legitimately large merchant is not flagged on every payout while thresholds are tuned.
 */

import { randomUUID } from 'node:crypto';

export type PayoutAnomalyRule = 'single_amount' | 'velocity_count' | 'velocity_amount' | 'baseline_deviation';

export type PayoutAnomalySeverity = 'medium' | 'high';

export type PayoutAnomalyStatus = 'open' | 'confirmed' | 'false_positive';

export interface PayoutAnomalyConfig {
  /** Master switch. When false, `evaluate` records history but raises nothing. */
  enabled: boolean;
  singlePayoutThreshold: number;
  velocityWindowMs: number;
  velocityMaxCount: number;
  velocityMaxAmount: number;
  baselineMultiplier: number;
  baselineMinSamples: number;
  /** How many past payouts per merchant feed the rolling baseline. */
  baselineSampleSize: number;
}

export const DEFAULT_PAYOUT_ANOMALY_CONFIG: Readonly<PayoutAnomalyConfig> = Object.freeze({
  enabled: true,
  singlePayoutThreshold: 50_000,
  velocityWindowMs: 60 * 60 * 1000,
  velocityMaxCount: 20,
  velocityMaxAmount: 100_000,
  baselineMultiplier: 5,
  baselineMinSamples: 5,
  baselineSampleSize: 50,
});

export interface PayoutObservation {
  /** Reference the payout is tracked under (batch id, scheduled payout id, ...). */
  reference: string;
  merchantId: string;
  amount: number;
  asset: string;
  at?: Date;
}

export interface PayoutAnomalyFlag {
  id: string;
  reference: string;
  merchantId: string;
  amount: number;
  asset: string;
  rule: PayoutAnomalyRule;
  severity: PayoutAnomalySeverity;
  message: string;
  /** The values the rule compared, for the reviewer. */
  observed: Record<string, number>;
  status: PayoutAnomalyStatus;
  createdAt: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNote?: string;
}

export interface PayoutAnomalyReview {
  reviewerId: string;
  decision: 'confirmed' | 'false_positive';
  note?: string;
  /** For false positives: skip this rule for this merchant for the given duration. */
  suppressForMs?: number;
}

export type PayoutAnomalyAlertSink = (flag: PayoutAnomalyFlag) => void;
export type PayoutAnomalyReviewSink = (flag: PayoutAnomalyFlag) => void;

export interface PayoutAnomalyDetectorOptions {
  config?: Partial<PayoutAnomalyConfig>;
  /** Receives every new flag. Defaults to a structured console warning. */
  onAlert?: PayoutAnomalyAlertSink;
  /** Receives every reviewed flag, so held payouts can be released or cancelled. */
  onReview?: PayoutAnomalyReviewSink;
  now?: () => Date;
}

/** Upper bound on suppression so a false positive cannot silence a rule indefinitely. */
export const MAX_ANOMALY_SUPPRESSION_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_TRACKED_FLAGS = 10_000;

const ENV_KEYS: Readonly<Record<keyof Omit<PayoutAnomalyConfig, 'enabled'>, string>> = Object.freeze({
  singlePayoutThreshold: 'PAYOUT_ANOMALY_SINGLE_THRESHOLD',
  velocityWindowMs: 'PAYOUT_ANOMALY_VELOCITY_WINDOW_MS',
  velocityMaxCount: 'PAYOUT_ANOMALY_VELOCITY_MAX_COUNT',
  velocityMaxAmount: 'PAYOUT_ANOMALY_VELOCITY_MAX_AMOUNT',
  baselineMultiplier: 'PAYOUT_ANOMALY_BASELINE_MULTIPLIER',
  baselineMinSamples: 'PAYOUT_ANOMALY_BASELINE_MIN_SAMPLES',
  baselineSampleSize: 'PAYOUT_ANOMALY_BASELINE_SAMPLE_SIZE',
});

/** Reads thresholds from `PAYOUT_ANOMALY_*` variables, ignoring unset or invalid values. */
export function payoutAnomalyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<PayoutAnomalyConfig> {
  const config: Partial<PayoutAnomalyConfig> = {};
  for (const [field, key] of Object.entries(ENV_KEYS) as [keyof typeof ENV_KEYS, string][]) {
    const raw = env[key];
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) config[field] = value;
  }
  if (env.PAYOUT_ANOMALY_DETECTION_ENABLED !== undefined) {
    config.enabled = env.PAYOUT_ANOMALY_DETECTION_ENABLED !== 'false';
  }
  return config;
}

function validateConfig(config: PayoutAnomalyConfig): PayoutAnomalyConfig {
  for (const field of Object.keys(ENV_KEYS) as (keyof typeof ENV_KEYS)[]) {
    const value = config[field];
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`INVALID_PAYOUT_ANOMALY_CONFIG:${field}`);
    }
  }
  if (typeof config.enabled !== 'boolean') throw new Error('INVALID_PAYOUT_ANOMALY_CONFIG:enabled');
  return {
    ...config,
    velocityMaxCount: Math.floor(config.velocityMaxCount),
    baselineMinSamples: Math.floor(config.baselineMinSamples),
    baselineSampleSize: Math.floor(config.baselineSampleSize),
  };
}

const defaultAlertSink: PayoutAnomalyAlertSink = (flag) => {
  console.warn(
    JSON.stringify({
      level: 'warn',
      msg: 'payout anomaly flagged',
      flagId: flag.id,
      rule: flag.rule,
      severity: flag.severity,
      merchantId: flag.merchantId,
      reference: flag.reference,
      amount: flag.amount,
      asset: flag.asset,
    }),
  );
};

function snapshotFlag(flag: PayoutAnomalyFlag): PayoutAnomalyFlag {
  return {
    ...flag,
    observed: { ...flag.observed },
    createdAt: new Date(flag.createdAt),
    ...(flag.reviewedAt ? { reviewedAt: new Date(flag.reviewedAt) } : {}),
  };
}

interface HistoryPoint {
  amount: number;
  at: number;
}

export class PayoutAnomalyDetector {
  private config: PayoutAnomalyConfig;
  private readonly history = new Map<string, HistoryPoint[]>(); // merchantId -> payouts
  private readonly flags = new Map<string, PayoutAnomalyFlag>();
  private readonly suppressions = new Map<string, number>(); // `${merchantId}:${rule}` -> until epoch ms
  private readonly alertSinks: PayoutAnomalyAlertSink[];
  private readonly reviewSinks: PayoutAnomalyReviewSink[];
  private readonly now: () => Date;

  constructor(options: PayoutAnomalyDetectorOptions = {}) {
    this.config = validateConfig({ ...DEFAULT_PAYOUT_ANOMALY_CONFIG, ...options.config });
    this.alertSinks = [options.onAlert ?? defaultAlertSink];
    this.reviewSinks = options.onReview ? [options.onReview] : [];
    this.now = options.now ?? (() => new Date());
  }

  getConfig(): PayoutAnomalyConfig {
    return { ...this.config };
  }

  /** Applies a partial config change atomically; an invalid value rejects the whole update. */
  updateConfig(patch: Partial<PayoutAnomalyConfig>): PayoutAnomalyConfig {
    this.config = validateConfig({ ...this.config, ...patch });
    return this.getConfig();
  }

  /** Adds an alert subscriber (webhook, pager, metrics). Returns an unsubscribe function. */
  onAlert(sink: PayoutAnomalyAlertSink): () => void {
    this.alertSinks.push(sink);
    return () => {
      const index = this.alertSinks.indexOf(sink);
      if (index >= 0) this.alertSinks.splice(index, 1);
    };
  }

  /** Adds a review subscriber. Returns an unsubscribe function. */
  onReview(sink: PayoutAnomalyReviewSink): () => void {
    this.reviewSinks.push(sink);
    return () => {
      const index = this.reviewSinks.indexOf(sink);
      if (index >= 0) this.reviewSinks.splice(index, 1);
    };
  }

  /**
   * Scores a payout against the merchant's history, records it, and returns the flags it
   * raised (empty when nothing is unusual). Rules compare against history *before* this
   * payout, so a payout never counts towards its own baseline.
   */
  evaluate(observation: PayoutObservation): PayoutAnomalyFlag[] {
    if (!Number.isFinite(observation.amount) || observation.amount < 0) {
      throw new Error('INVALID_PAYOUT_ANOMALY_AMOUNT');
    }

    const at = (observation.at ?? this.now()).getTime();
    const history = this.history.get(observation.merchantId) ?? [];
    const raised: PayoutAnomalyFlag[] = [];

    if (this.config.enabled) {
      const cfg = this.config;
      const windowStart = at - cfg.velocityWindowMs;
      const inWindow = history.filter((point) => point.at > windowStart);
      const windowCount = inWindow.length + 1;
      const windowAmount = inWindow.reduce((sum, point) => sum + point.amount, 0) + observation.amount;

      if (observation.amount >= cfg.singlePayoutThreshold) {
        this.raise(raised, observation, 'single_amount', 'high', 'Payout exceeds the single-payout threshold', {
          amount: observation.amount,
          threshold: cfg.singlePayoutThreshold,
        });
      }

      if (windowCount > cfg.velocityMaxCount) {
        this.raise(raised, observation, 'velocity_count', 'medium', 'Too many payouts inside the velocity window', {
          count: windowCount,
          maxCount: cfg.velocityMaxCount,
          windowMs: cfg.velocityWindowMs,
        });
      }

      if (windowAmount > cfg.velocityMaxAmount) {
        this.raise(raised, observation, 'velocity_amount', 'high', 'Payout volume inside the velocity window is too high', {
          amount: windowAmount,
          maxAmount: cfg.velocityMaxAmount,
          windowMs: cfg.velocityWindowMs,
        });
      }

      if (history.length >= cfg.baselineMinSamples) {
        const baseline = history.reduce((sum, point) => sum + point.amount, 0) / history.length;
        if (baseline > 0 && observation.amount > baseline * cfg.baselineMultiplier) {
          this.raise(raised, observation, 'baseline_deviation', 'medium', 'Payout is far above the merchant baseline', {
            amount: observation.amount,
            baseline,
            multiplier: cfg.baselineMultiplier,
          });
        }
      }
    }

    history.push({ amount: observation.amount, at });
    while (history.length > this.config.baselineSampleSize) history.shift();
    this.history.set(observation.merchantId, history);

    return raised.map(snapshotFlag);
  }

  /** Records a reviewer's decision on an open flag. Returns the updated flag. */
  review(flagId: string, review: PayoutAnomalyReview): PayoutAnomalyFlag {
    const flag = this.flags.get(flagId);
    if (!flag) throw new Error('PAYOUT_ANOMALY_NOT_FOUND');
    if (flag.status !== 'open') throw new Error('PAYOUT_ANOMALY_ALREADY_REVIEWED');
    if (!review.reviewerId) throw new Error('PAYOUT_ANOMALY_REVIEWER_REQUIRED');
    if (review.decision !== 'confirmed' && review.decision !== 'false_positive') {
      throw new Error('PAYOUT_ANOMALY_INVALID_DECISION');
    }

    flag.status = review.decision;
    flag.reviewedBy = review.reviewerId;
    flag.reviewedAt = this.now();
    if (review.note) flag.reviewNote = review.note;

    if (review.decision === 'false_positive' && review.suppressForMs !== undefined) {
      if (!Number.isFinite(review.suppressForMs) || review.suppressForMs <= 0) {
        throw new Error('PAYOUT_ANOMALY_INVALID_SUPPRESSION');
      }
      const duration = Math.min(review.suppressForMs, MAX_ANOMALY_SUPPRESSION_MS);
      this.suppressions.set(`${flag.merchantId}:${flag.rule}`, this.now().getTime() + duration);
    }

    const snapshot = snapshotFlag(flag);
    for (const sink of this.reviewSinks) {
      try {
        sink(snapshot);
      } catch {
        // A failing subscriber must not undo a recorded review decision.
      }
    }
    return snapshot;
  }

  getFlag(flagId: string): PayoutAnomalyFlag | undefined {
    const flag = this.flags.get(flagId);
    return flag ? snapshotFlag(flag) : undefined;
  }

  listFlags(filter: { status?: PayoutAnomalyStatus; merchantId?: string; reference?: string } = {}): PayoutAnomalyFlag[] {
    return [...this.flags.values()]
      .filter((flag) => !filter.status || flag.status === filter.status)
      .filter((flag) => !filter.merchantId || flag.merchantId === filter.merchantId)
      .filter((flag) => !filter.reference || flag.reference === filter.reference)
      .map(snapshotFlag);
  }

  /** True while any flag raised against `reference` is still awaiting review. */
  hasOpenFlags(reference: string): boolean {
    for (const flag of this.flags.values()) {
      if (flag.reference === reference && flag.status === 'open') return true;
    }
    return false;
  }

  /** Clears history, flags and suppressions. Intended for tests. */
  reset(): void {
    this.history.clear();
    this.flags.clear();
    this.suppressions.clear();
  }

  private isSuppressed(merchantId: string, rule: PayoutAnomalyRule): boolean {
    const key = `${merchantId}:${rule}`;
    const until = this.suppressions.get(key);
    if (until === undefined) return false;
    if (until <= this.now().getTime()) {
      this.suppressions.delete(key);
      return false;
    }
    return true;
  }

  /** Raises a flag into `into` unless the rule is suppressed for this merchant. */
  private raise(
    into: PayoutAnomalyFlag[],
    observation: PayoutObservation,
    rule: PayoutAnomalyRule,
    severity: PayoutAnomalySeverity,
    message: string,
    observed: Record<string, number>,
  ): void {
    if (this.isSuppressed(observation.merchantId, rule)) return;

    const flag: PayoutAnomalyFlag = {
      id: `pan_${randomUUID()}`,
      reference: observation.reference,
      merchantId: observation.merchantId,
      amount: observation.amount,
      asset: observation.asset,
      rule,
      severity,
      message,
      observed,
      status: 'open',
      createdAt: this.now(),
    };

    this.flags.set(flag.id, flag);
    this.evictReviewedFlags();

    const snapshot = snapshotFlag(flag);
    for (const sink of this.alertSinks) {
      try {
        sink(snapshot);
      } catch {
        // Alert delivery problems must never block the payout decision.
      }
    }
    into.push(flag);
  }

  /** Bounds memory by dropping the oldest reviewed flags; open flags are always kept. */
  private evictReviewedFlags(): void {
    if (this.flags.size <= MAX_TRACKED_FLAGS) return;
    for (const [id, flag] of this.flags) {
      if (this.flags.size <= MAX_TRACKED_FLAGS) break;
      if (flag.status !== 'open') this.flags.delete(id);
    }
  }
}

export const payoutAnomalyDetector = new PayoutAnomalyDetector({ config: payoutAnomalyConfigFromEnv() });
