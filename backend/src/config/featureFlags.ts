/**
 * featureFlags.ts
 *
 * Feature flag system for AgenticPay backend.
 *
 * ## Features
 *
 * - **Define flags** — typed registry with description, default, and rollout strategy
 * - **Toggle via config** — env var `FEATURE_<NAME>=true|false|<N>%` overrides defaults
 * - **Track usage** — per-flag counters: total evaluations, enabled hits, disabled hits
 * - **Gradual rollout** — percentage-based rollout using a consistent FNV-1a hash of a
 *   caller-supplied identifier (IP, user ID, API key) so the same caller always gets
 *   the same result across requests
 *
 * ## Environment variable format
 *
 * | Value       | Effect                                       |
 * |-------------|----------------------------------------------|
 * | `true`      | Force-enable for all callers                 |
 * | `false`     | Force-disable for all callers                |
 * | `25%`       | Enable for ~25 % of callers (hash-stable)    |
 * | _(absent)_  | Use the flag's `defaultEnabled` value         |
 *
 * Example:
 *   ```
 *   FEATURE_AI_VERIFICATION=false
 *   FEATURE_BULK_VERIFICATION=50%
 *   FEATURE_MESSAGE_QUEUE=true
 *   ```
 *
 * ## Runtime override (for testing / gradual rollout via API)
 *
 *   ```ts
 *   featureFlags.override('ai-verification', { enabled: false });
 *   featureFlags.override('bulk-verification', { rolloutPercentage: 25 });
 *   featureFlags.reset('ai-verification');
 *   ```
 */

// ─── Rollout strategies ───────────────────────────────────────────────────────

/**
 * - `all`        — enabled for every caller
 * - `none`       — disabled for every caller
 * - `percentage` — enabled for a hash-stable percentage of callers
 * - `allowlist`  — enabled only for callers whose identifier appears in the list
 */
export type RolloutStrategy = 'all' | 'none' | 'percentage' | 'allowlist';

// ─── Flag definitions ─────────────────────────────────────────────────────────

export interface FeatureFlagDefinition {
  /** Unique machine-readable identifier (kebab-case). */
  name: FeatureFlagName;
  /** Human-readable description shown in the admin API. */
  description: string;
  /** Enabled by default when no env-var override is present. */
  defaultEnabled: boolean;
  /** How to decide whether a given caller gets this feature. */
  strategy: RolloutStrategy;
  /** Percentage (0–100) of callers to enable — only used with `strategy: 'percentage'`. */
  rolloutPercentage?: number;
  /** Explicit list of identifiers to enable — only used with `strategy: 'allowlist'`. */
  allowlist?: string[];
}

/** All known feature flag names. Extend this union when adding new flags. */
export type FeatureFlagName =
  | 'ai-verification'
  | 'bulk-verification'
  | 'batch-operations'
  | 'job-scheduling'
  | 'message-queue'
  | 'rate-limit-tiering'
  | 'sla-tracking'
  | 'response-caching';

// ─── Runtime state ────────────────────────────────────────────────────────────

export interface FlagUsageStats {
  /** Total times this flag was evaluated. */
  totalEvaluations: number;
  /** Times the evaluation returned `true`. */
  enabledCount: number;
  /** Times the evaluation returned `false`. */
  disabledCount: number;
  /** ISO timestamp of the most recent evaluation, or null if never evaluated. */
  lastEvaluatedAt: string | null;
}

export interface FlagState {
  definition: FeatureFlagDefinition;
  /** Current effective strategy (may differ from definition if overridden at runtime). */
  currentStrategy: RolloutStrategy;
  /** Current effective rollout percentage (may differ from definition if overridden). */
  currentRolloutPercentage: number;
  /** Whether the flag has been runtime-overridden (vs. config/default value). */
  overridden: boolean;
  usage: FlagUsageStats;
}

// ─── Override config ──────────────────────────────────────────────────────────

export interface FlagOverrideConfig {
  /** Force-enable (`true`) or force-disable (`false`) for all callers. */
  enabled?: boolean;
  /** Set rollout percentage (0–100). Automatically sets strategy to `'percentage'`. */
  rolloutPercentage?: number;
  /** Replace the allowlist. Automatically sets strategy to `'allowlist'`. */
  allowlist?: string[];
}

// ─── Built-in flag definitions ────────────────────────────────────────────────

const FLAG_DEFINITIONS: FeatureFlagDefinition[] = [
  {
    name: 'ai-verification',
    description: 'AI-powered work verification via OpenAI — requires OPENAI_API_KEY',
    defaultEnabled: true,
    strategy: 'all',
  },
  {
    name: 'bulk-verification',
    description: 'Bulk AI verification endpoint (POST /verification/verify/batch)',
    defaultEnabled: true,
    strategy: 'all',
  },
  {
    name: 'batch-operations',
    description: 'Bulk update and delete operations on verification results',
    defaultEnabled: true,
    strategy: 'all',
  },
  {
    name: 'job-scheduling',
    description: 'Background job scheduler (mirrors JOBS_ENABLED env var)',
    defaultEnabled: process.env.JOBS_ENABLED !== 'false',
    strategy: 'all',
  },
  {
    name: 'message-queue',
    description: 'In-process message queue for async task processing',
    defaultEnabled: process.env.QUEUE_ENABLED !== 'false',
    strategy: 'all',
  },
  {
    name: 'rate-limit-tiering',
    description: 'Tiered rate limiting (free/pro/enterprise) based on X-User-Tier header',
    defaultEnabled: true,
    strategy: 'all',
  },
  {
    name: 'sla-tracking',
    description: 'SLA tracking middleware — records request latencies for SLA reporting',
    defaultEnabled: true,
    strategy: 'all',
  },
  {
    name: 'response-caching',
    description: 'ETag-based HTTP response caching on stable GET endpoints',
    defaultEnabled: true,
    strategy: 'percentage',
    rolloutPercentage: 100,
  },
];

// ─── Consistent-hash helper ───────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash of a string, returned as a value in [0, 99].
 * Using a stable hash ensures the same identifier always maps to the
 * same bucket — critical for gradual rollout so users don't flip on/off.
 */
function hashToBucket(identifier: string): number {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < identifier.length; i++) {
    hash ^= identifier.charCodeAt(i);
    // Unsigned 32-bit multiply
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 100;
}

// ─── FeatureFlagRegistry ─────────────────────────────────────────────────────

class FeatureFlagRegistry {
  private readonly state = new Map<FeatureFlagName, FlagState>();

  constructor(definitions: FeatureFlagDefinition[]) {
    for (const def of definitions) {
      const envOverride = this.readEnvOverride(def.name);
      this.state.set(def.name, {
        definition: { ...def },
        currentStrategy: envOverride?.strategy ?? def.strategy,
        currentRolloutPercentage: envOverride?.rolloutPercentage ?? def.rolloutPercentage ?? 100,
        overridden: envOverride !== null,
        usage: {
          totalEvaluations: 0,
          enabledCount: 0,
          disabledCount: 0,
          lastEvaluatedAt: null,
        },
      });
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Evaluates a flag for a given caller identifier.
   *
   * @param name        The feature flag name.
   * @param identifier  Optional caller identifier (IP, user ID, API key) used
   *                    for hash-based percentage rollout and allowlist checks.
   *                    Defaults to `'anonymous'` when omitted.
   * @returns `true` if the feature is enabled for this caller, `false` otherwise.
   */
  evaluate(name: FeatureFlagName, identifier = 'anonymous'): boolean {
    const flagState = this.state.get(name);
    if (!flagState) {
      console.warn(`[FeatureFlags] Unknown flag '${name}' evaluated — defaulting to false`);
      return false;
    }

    const result = this.computeResult(flagState, identifier);
    this.recordUsage(flagState, result);
    return result;
  }

  /**
   * Returns the current state and usage stats for all registered flags.
   */
  getAll(): FlagState[] {
    return Array.from(this.state.values()).map((s) => ({ ...s, usage: { ...s.usage } }));
  }

  /**
   * Returns the current state for a single flag, or `null` if not found.
   */
  get(name: FeatureFlagName): FlagState | null {
    const s = this.state.get(name);
    return s ? { ...s, usage: { ...s.usage } } : null;
  }

  /**
   * Applies a runtime override to a flag.
   * Useful for canary deployments, A/B tests, and emergency kill-switches.
   *
   * @param name   The flag to override.
   * @param config What to change.
   */
  override(name: FeatureFlagName, config: FlagOverrideConfig): void {
    const flagState = this.state.get(name);
    if (!flagState) {
      throw new Error(`[FeatureFlags] Cannot override unknown flag '${name}'`);
    }

    if (config.enabled !== undefined) {
      flagState.currentStrategy = config.enabled ? 'all' : 'none';
    }

    if (config.rolloutPercentage !== undefined) {
      if (config.rolloutPercentage < 0 || config.rolloutPercentage > 100) {
        throw new Error(`rolloutPercentage must be between 0 and 100`);
      }
      flagState.currentStrategy = 'percentage';
      flagState.currentRolloutPercentage = config.rolloutPercentage;
    }

    if (config.allowlist !== undefined) {
      flagState.currentStrategy = 'allowlist';
      flagState.definition.allowlist = config.allowlist;
    }

    flagState.overridden = true;

    console.info(
      `[FeatureFlags] '${name}' overridden → strategy=${flagState.currentStrategy}` +
      (flagState.currentStrategy === 'percentage' ? ` (${flagState.currentRolloutPercentage}%)` : ''),
    );
  }

  /**
   * Resets a flag back to its default (definition + env-var) state.
   */
  reset(name: FeatureFlagName): void {
    const flagState = this.state.get(name);
    if (!flagState) return;

    const def = flagState.definition;
    const envOverride = this.readEnvOverride(name);

    flagState.currentStrategy = envOverride?.strategy ?? def.strategy;
    flagState.currentRolloutPercentage =
      envOverride?.rolloutPercentage ?? def.rolloutPercentage ?? 100;
    flagState.overridden = envOverride !== null;

    console.info(`[FeatureFlags] '${name}' reset to ${flagState.currentStrategy}`);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private computeResult(flagState: FlagState, identifier: string): boolean {
    switch (flagState.currentStrategy) {
      case 'all':
        return true;

      case 'none':
        return false;

      case 'percentage': {
        const bucket = hashToBucket(identifier);
        return bucket < flagState.currentRolloutPercentage;
      }

      case 'allowlist': {
        const list = flagState.definition.allowlist ?? [];
        return list.includes(identifier);
      }

      default:
        return false;
    }
  }

  private recordUsage(flagState: FlagState, result: boolean): void {
    flagState.usage.totalEvaluations += 1;
    if (result) {
      flagState.usage.enabledCount += 1;
    } else {
      flagState.usage.disabledCount += 1;
    }
    flagState.usage.lastEvaluatedAt = new Date().toISOString();
  }

  /**
   * Parses `FEATURE_<NAME>` environment variable.
   *
   * | Env value | Parsed strategy     |
   * |-----------|---------------------|
   * | `true`    | `all`               |
   * | `false`   | `none`              |
   * | `25%`     | `percentage` (25)   |
   * | absent    | `null` (use default)|
   */
  private readEnvOverride(
    name: FeatureFlagName,
  ): { strategy: RolloutStrategy; rolloutPercentage?: number } | null {
    const envKey = `FEATURE_${name.toUpperCase().replace(/-/g, '_')}`;
    const raw = process.env[envKey];
    if (raw === undefined) return null;

    const trimmed = raw.trim().toLowerCase();
    if (trimmed === 'true')  return { strategy: 'all' };
    if (trimmed === 'false') return { strategy: 'none' };

    const pctMatch = trimmed.match(/^(\d+(?:\.\d+)?)%$/);
    if (pctMatch) {
      const pct = Math.min(100, Math.max(0, parseFloat(pctMatch[1])));
      return { strategy: 'percentage', rolloutPercentage: pct };
    }

    console.warn(
      `[FeatureFlags] Unrecognised value for ${envKey}="${raw}" — expected true|false|<N>%. Using default.`,
    );
    return null;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * The global feature flag registry. Import this singleton wherever flag
 * evaluation is needed.
 *
 * @example
 * ```ts
 * import { featureFlags } from '../config/featureFlags.js';
 *
 * if (featureFlags.evaluate('ai-verification', req.ip)) {
 *   // run AI path
 * }
 * ```
 */
export const featureFlags = new FeatureFlagRegistry(FLAG_DEFINITIONS);
