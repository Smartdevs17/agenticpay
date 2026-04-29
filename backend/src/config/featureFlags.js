"use strict";
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
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.featureFlags = void 0;
// ─── Built-in flag definitions ────────────────────────────────────────────────
var FLAG_DEFINITIONS = [
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
function hashToBucket(identifier) {
    var hash = 2166136261; // FNV offset basis
    for (var i = 0; i < identifier.length; i++) {
        hash ^= identifier.charCodeAt(i);
        // Unsigned 32-bit multiply
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash % 100;
}
// ─── FeatureFlagRegistry ─────────────────────────────────────────────────────
var FeatureFlagRegistry = /** @class */ (function () {
    function FeatureFlagRegistry(definitions) {
        var _a, _b, _c;
        this.state = new Map();
        for (var _i = 0, definitions_1 = definitions; _i < definitions_1.length; _i++) {
            var def = definitions_1[_i];
            var envOverride = this.readEnvOverride(def.name);
            this.state.set(def.name, {
                definition: __assign({}, def),
                currentStrategy: (_a = envOverride === null || envOverride === void 0 ? void 0 : envOverride.strategy) !== null && _a !== void 0 ? _a : def.strategy,
                currentRolloutPercentage: (_c = (_b = envOverride === null || envOverride === void 0 ? void 0 : envOverride.rolloutPercentage) !== null && _b !== void 0 ? _b : def.rolloutPercentage) !== null && _c !== void 0 ? _c : 100,
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
    FeatureFlagRegistry.prototype.evaluate = function (name, identifier) {
        if (identifier === void 0) { identifier = 'anonymous'; }
        var flagState = this.state.get(name);
        if (!flagState) {
            console.warn("[FeatureFlags] Unknown flag '".concat(name, "' evaluated \u2014 defaulting to false"));
            return false;
        }
        var result = this.computeResult(flagState, identifier);
        this.recordUsage(flagState, result);
        return result;
    };
    /**
     * Returns the current state and usage stats for all registered flags.
     */
    FeatureFlagRegistry.prototype.getAll = function () {
        return Array.from(this.state.values()).map(function (s) { return (__assign(__assign({}, s), { usage: __assign({}, s.usage) })); });
    };
    /**
     * Returns the current state for a single flag, or `null` if not found.
     */
    FeatureFlagRegistry.prototype.get = function (name) {
        var s = this.state.get(name);
        return s ? __assign(__assign({}, s), { usage: __assign({}, s.usage) }) : null;
    };
    /**
     * Applies a runtime override to a flag.
     * Useful for canary deployments, A/B tests, and emergency kill-switches.
     *
     * @param name   The flag to override.
     * @param config What to change.
     */
    FeatureFlagRegistry.prototype.override = function (name, config) {
        var flagState = this.state.get(name);
        if (!flagState) {
            throw new Error("[FeatureFlags] Cannot override unknown flag '".concat(name, "'"));
        }
        if (config.enabled !== undefined) {
            flagState.currentStrategy = config.enabled ? 'all' : 'none';
        }
        if (config.rolloutPercentage !== undefined) {
            if (config.rolloutPercentage < 0 || config.rolloutPercentage > 100) {
                throw new Error("rolloutPercentage must be between 0 and 100");
            }
            flagState.currentStrategy = 'percentage';
            flagState.currentRolloutPercentage = config.rolloutPercentage;
        }
        if (config.allowlist !== undefined) {
            flagState.currentStrategy = 'allowlist';
            flagState.definition.allowlist = config.allowlist;
        }
        flagState.overridden = true;
        console.info("[FeatureFlags] '".concat(name, "' overridden \u2192 strategy=").concat(flagState.currentStrategy) +
            (flagState.currentStrategy === 'percentage' ? " (".concat(flagState.currentRolloutPercentage, "%)") : ''));
    };
    /**
     * Resets a flag back to its default (definition + env-var) state.
     */
    FeatureFlagRegistry.prototype.reset = function (name) {
        var _a, _b, _c;
        var flagState = this.state.get(name);
        if (!flagState)
            return;
        var def = flagState.definition;
        var envOverride = this.readEnvOverride(name);
        flagState.currentStrategy = (_a = envOverride === null || envOverride === void 0 ? void 0 : envOverride.strategy) !== null && _a !== void 0 ? _a : def.strategy;
        flagState.currentRolloutPercentage =
            (_c = (_b = envOverride === null || envOverride === void 0 ? void 0 : envOverride.rolloutPercentage) !== null && _b !== void 0 ? _b : def.rolloutPercentage) !== null && _c !== void 0 ? _c : 100;
        flagState.overridden = envOverride !== null;
        console.info("[FeatureFlags] '".concat(name, "' reset to ").concat(flagState.currentStrategy));
    };
    // ── Private helpers ─────────────────────────────────────────────────────────
    FeatureFlagRegistry.prototype.computeResult = function (flagState, identifier) {
        var _a;
        switch (flagState.currentStrategy) {
            case 'all':
                return true;
            case 'none':
                return false;
            case 'percentage': {
                var bucket = hashToBucket(identifier);
                return bucket < flagState.currentRolloutPercentage;
            }
            case 'allowlist': {
                var list = (_a = flagState.definition.allowlist) !== null && _a !== void 0 ? _a : [];
                return list.includes(identifier);
            }
            default:
                return false;
        }
    };
    FeatureFlagRegistry.prototype.recordUsage = function (flagState, result) {
        flagState.usage.totalEvaluations += 1;
        if (result) {
            flagState.usage.enabledCount += 1;
        }
        else {
            flagState.usage.disabledCount += 1;
        }
        flagState.usage.lastEvaluatedAt = new Date().toISOString();
    };
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
    FeatureFlagRegistry.prototype.readEnvOverride = function (name) {
        var envKey = "FEATURE_".concat(name.toUpperCase().replace(/-/g, '_'));
        var raw = process.env[envKey];
        if (raw === undefined)
            return null;
        var trimmed = raw.trim().toLowerCase();
        if (trimmed === 'true')
            return { strategy: 'all' };
        if (trimmed === 'false')
            return { strategy: 'none' };
        var pctMatch = trimmed.match(/^(\d+(?:\.\d+)?)%$/);
        if (pctMatch) {
            var pct = Math.min(100, Math.max(0, parseFloat(pctMatch[1])));
            return { strategy: 'percentage', rolloutPercentage: pct };
        }
        console.warn("[FeatureFlags] Unrecognised value for ".concat(envKey, "=\"").concat(raw, "\" \u2014 expected true|false|<N>%. Using default."));
        return null;
    };
    return FeatureFlagRegistry;
}());
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
exports.featureFlags = new FeatureFlagRegistry(FLAG_DEFINITIONS);
