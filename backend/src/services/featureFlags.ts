import { createHash } from 'node:crypto';

export interface FeatureFlagMetrics {
servedTrue: number;
servedFalse: number;
}

export interface FeatureFlag {
name: string;
enabled: boolean;
rolloutPercentage: number;
targetedUsers: Set<string>;
metrics: FeatureFlagMetrics; // <-- Added metrics tracking
}

class FeatureFlagService {
private flags: Map<string, FeatureFlag> = new Map();

constructor() {
    // Initialize with some default flags for testing
    this.upsertFlag('new-checkout-flow', true, 20); // 20% A/B test
    this.upsertFlag('beta-dashboard', true, 0, ['dev-user-1', 'qa-tester']); // Targeted rollout
  }

  public upsertFlag(name: string, enabled: boolean, rolloutPercentage: number = 0, targetedUsers: string[] = []): void {
    const existing = this.flags.get(name);

    this.flags.set(name, {
      name,
      enabled,
      rolloutPercentage: Math.max(0, Math.min(100, rolloutPercentage)),
      targetedUsers: new Set(targetedUsers),
      // Preserve existing metrics on update, or initialize to 0
      metrics: existing?.metrics || { servedTrue: 0, servedFalse: 0 }
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

    // 3. If rollout is 100%, return true
    if (flag.rolloutPercentage === 100) {
      return trackAndReturn(true);
    }

    // 4. If rollout is 0%, return false
    if (flag.rolloutPercentage === 0) {
      return trackAndReturn(false);
    }

    // 5. Deterministic Percentage Rollout (A/B Testing)
    // Hash the flag name + identifier so the same user always gets the same experience
    const hash = createHash('md5').update(`${flagName}-${identifier}`).digest('hex');
    // Take the first 4 characters, convert to integer, and map to a 1-100 range
    const hashInt = parseInt(hash.substring(0, 4), 16);
    const normalizedHash = (hashInt % 100) + 1;

    return trackAndReturn(normalizedHash <= flag.rolloutPercentage);
  }
}

export const featureFlagEngine = new FeatureFlagService();