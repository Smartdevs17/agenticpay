import { createHash } from "node:crypto";

export interface FeatureFlagMetrics {
  servedTrue: number;
  servedFalse: number;
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
    this.upsertFlag("new-checkout-flow", true, 20);
    this.upsertFlag("beta-dashboard", true, 0, ["dev-user-1", "qa-tester"]);
  }

  public upsertFlag(
    name: string,
    enabled: boolean,
    rolloutPercentage: number = 0,
    targetedUsers: string[] = [],
    variants: FeatureFlagVariant[] = [],
    rolloutSchedule?: RolloutSchedule
  ): void {
    const existing = this.flags.get(name);

    let effectiveRollout = Math.max(0, Math.min(100, rolloutPercentage));

    if (rolloutSchedule) {
      const now = Date.now();
      const start = rolloutSchedule.startTime.getTime();
      const end = rolloutSchedule.endTime.getTime();
      if (now <= start) {
        effectiveRollout = rolloutSchedule.startPercentage;
      } else if (now >= end) {
        effectiveRollout = rolloutSchedule.endPercentage;
      } else {
        const progress = (now - start) / (end - start);
        effectiveRollout = Math.round(
          rolloutSchedule.startPercentage + progress * (rolloutSchedule.endPercentage - rolloutSchedule.startPercentage)
        );
      }
    }

    this.flags.set(name, {
      name,
      enabled,
      rolloutPercentage: effectiveRollout,
      targetedUsers: new Set(targetedUsers),
      metrics: existing?.metrics || { servedTrue: 0, servedFalse: 0 },
      variants: variants.length > 0 ? variants : existing?.variants,
      rolloutSchedule: rolloutSchedule || existing?.rolloutSchedule,
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

  public evaluate(flagName: string, identifier: string = ""): boolean {
    const flag = this.flags.get(flagName);

    const trackAndReturn = (result: boolean) => {
      if (flag) {
        result ? (flag.metrics.servedTrue++) : (flag.metrics.servedFalse++);
      }
      return result;
    };

    if (!flag || !flag.enabled) {
      return trackAndReturn(false);
    }

    if (identifier && flag.targetedUsers.has(identifier)) {
      return trackAndReturn(true);
    }

    if (flag.rolloutPercentage === 100) {
      return trackAndReturn(true);
    }

    if (flag.rolloutPercentage === 0) {
      return trackAndReturn(false);
    }

    const hash = createHash("md5").update(`${flagName}-${identifier}`).digest("hex");
    const hashInt = parseInt(hash.substring(0, 4), 16);
    const normalizedHash = (hashInt % 100) + 1;

    return trackAndReturn(normalizedHash <= flag.rolloutPercentage);
  }

  public evaluateVariant(flagName: string, identifier: string): string | null {
    const flag = this.flags.get(flagName);

    if (!flag || !flag.enabled || !flag.variants || flag.variants.length === 0) {
      return null;
    }

    const totalWeight = flag.variants.reduce((sum, v) => sum + v.weight, 0);
    const hash = createHash("md5").update(`${flagName}-variant-${identifier}`).digest("hex");
    const hashInt = parseInt(hash.substring(0, 8), 16);
    const bucket = hashInt % totalWeight;

    let cumulative = 0;
    for (const variant of flag.variants) {
      cumulative += variant.weight;
      if (bucket < cumulative) {
        return variant.key;
      }
    }

    return flag.variants[0]?.key || null;
  }
}

export const featureFlagEngine = new FeatureFlagService();
