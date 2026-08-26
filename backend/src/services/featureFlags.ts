import { createHash } from 'node:crypto';

export interface FeatureFlagMetrics {
  servedTrue: number;
  servedFalse: number;
  variantsServed?: Record<string, number>;
}

export interface FeatureFlagVariant {
  key: string;
  value: any;
  weight: number;
}

export interface RolloutSchedule {
  startPercentage: number;
  endPercentage: number;
  startTime: Date;
  endTime: Date;
}

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  rolloutPercentage: number;
  targetedUsers: Set<string>;
  metrics: FeatureFlagMetrics;
  variants?: FeatureFlagVariant[];
  rolloutSchedule?: RolloutSchedule;
}

class FeatureFlagService {
  private flags: Map<string, FeatureFlag> = new Map();

  constructor() {
    // Initialize with some default flags for testing
    this.upsertFlag('new-checkout-flow', true, 20); // 20% A/B test
    this.upsertFlag('beta-dashboard', true, 0, ['dev-user-1', 'qa-tester']); // Targeted rollout
  }

  public upsertFlag(
    name: string,
    enabled: boolean,
    rolloutPercentage: number = 0,
    targetedUsers: string[] = [],
    variants?: FeatureFlagVariant[],
    rolloutSchedule?: RolloutSchedule
  ): void {
    const existing = this.flags.get(name);
    
    const initialVariantsServed: Record<string, number> = {};
    if (variants) {
      for (const v of variants) {
        initialVariantsServed[v.key] = 0;
      }
    }
    const existingVariantsServed = existing?.metrics?.variantsServed || {};
    const variantsServed = { ...initialVariantsServed, ...existingVariantsServed };

    this.flags.set(name, {
      name,
      enabled,
      rolloutPercentage: Math.max(0, Math.min(100, rolloutPercentage)),
      targetedUsers: new Set(targetedUsers),
      metrics: {
        servedTrue: existing?.metrics?.servedTrue || 0,
        servedFalse: existing?.metrics?.servedFalse || 0,
        variantsServed,
      },
      variants,
      rolloutSchedule,
    });
  }

  public getFlag(name: string): FeatureFlag | undefined {
    return this.flags.get(name);
  }

  public getAllFlags(): FeatureFlag[] {
    return Array.from(this.flags.values());
  }

  public deleteFlag(name: string): void {
    this.flags.delete(name);
  }

  private getEffectiveRolloutPercentage(flag: FeatureFlag): number {
    if (!flag.rolloutSchedule) {
      return flag.rolloutPercentage;
    }

    const { startPercentage, endPercentage, startTime, endTime } = flag.rolloutSchedule;
    const now = Date.now();
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();

    if (now <= startMs) {
      return startPercentage;
    }
    if (now >= endMs) {
      return endPercentage;
    }

    // Linearly interpolate between startPercentage and endPercentage
    const progress = (now - startMs) / (endMs - startMs);
    const interpolated = startPercentage + (endPercentage - startPercentage) * progress;
    return Math.round(interpolated);
  }

  /**
   * Deterministic flag evaluation with analytics tracking.
   * Resolves in < 1ms to prevent API latency.
   */
  public evaluate(flagName: string, identifier: string): boolean {
    const flag = this.flags.get(flagName);

    // Helper to track metrics before returning
    const trackAndReturn = (result: boolean) => {
      if (flag) {
        result ? flag.metrics.servedTrue++ : flag.metrics.servedFalse++;
      }
      return result;
    };

    // 1. If flag doesn't exist or is globally disabled, return false (Instant Rollback)
    if (!flag || !flag.enabled) {
      return trackAndReturn(false);
    }

    // 2. If user is explicitly targeted, return true (User Targeting)
    if (flag.targetedUsers.has(identifier)) {
      return trackAndReturn(true);
    }

    const effectivePercentage = this.getEffectiveRolloutPercentage(flag);

    // 3. If rollout is 100%, return true
    if (effectivePercentage === 100) {
      return trackAndReturn(true);
    }

    // 4. If rollout is 0%, return false
    if (effectivePercentage === 0) {
      return trackAndReturn(false);
    }

    // 5. Deterministic Percentage Rollout (A/B Testing)
    // Hash the flag name + identifier so the same user always gets the same experience
    const hash = createHash('md5').update(`${flagName}-${identifier}`).digest('hex');
    // Take the first 4 characters, convert to integer, and map to a 1-100 range
    const hashInt = parseInt(hash.substring(0, 4), 16);
    const normalizedHash = (hashInt % 100) + 1;

    return trackAndReturn(normalizedHash <= effectivePercentage);
  }

  /**
   * Deterministically assigns a variant for A/B testing if the flag is enabled.
   */
  public evaluateVariant(flagName: string, identifier: string): string | undefined {
    const flag = this.flags.get(flagName);
    if (!flag || !flag.enabled) {
      return undefined;
    }

    // Check if the user is in the rollout bucket
    const isEnabled = this.evaluate(flagName, identifier);
    if (!isEnabled) {
      return undefined;
    }

    // If there are no variants, return undefined
    if (!flag.variants || flag.variants.length === 0) {
      return undefined;
    }

    // Deterministically assign to a variant using MD5 hashing of the flag name + identifier
    const hash = createHash('md5').update(`${flagName}-variant-${identifier}`).digest('hex');
    const hashInt = parseInt(hash.substring(0, 4), 16);
    
    const totalWeight = flag.variants.reduce((sum, v) => sum + v.weight, 0);
    if (totalWeight <= 0) {
      return undefined;
    }

    const bucket = hashInt % totalWeight;
    let cumulativeWeight = 0;

    for (const variant of flag.variants) {
      cumulativeWeight += variant.weight;
      if (bucket < cumulativeWeight) {
        // Track variant metrics
        if (!flag.metrics.variantsServed) {
          flag.metrics.variantsServed = {};
        }
        flag.metrics.variantsServed[variant.key] = (flag.metrics.variantsServed[variant.key] || 0) + 1;
        return variant.key;
      }
    }

    // Fallback
    const fallbackKey = flag.variants[0].key;
    if (!flag.metrics.variantsServed) {
      flag.metrics.variantsServed = {};
    }
    flag.metrics.variantsServed[fallbackKey] = (flag.metrics.variantsServed[fallbackKey] || 0) + 1;
    return fallbackKey;
  }
}

export const featureFlagEngine = new FeatureFlagService();