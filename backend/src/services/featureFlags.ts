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

/** Cohort A/B targeting — Issue #1354 */
export interface FeatureFlagCohort {
  id: string;
  name: string;
  /** Deterministic membership via hash bucket 0–99 when members is empty. */
  percentage?: number;
  members: Set<string>;
  /** Optional variant override for users in this cohort. */
  variantKey?: string;
  /** When set, evaluate() returns this for cohort members (else normal rollout). */
  forceEnabled?: boolean;
}

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  rolloutPercentage: number;
  targetedUsers: Set<string>;
  metrics: FeatureFlagMetrics;
  variants?: FeatureFlagVariant[];
  rolloutSchedule?: RolloutSchedule;
  cohorts?: Map<string, FeatureFlagCohort>;
}

export type CohortEvaluation = {
  enabled: boolean;
  cohortId: string | null;
  variant: string | null;
};

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
      cohorts: existing?.cohorts,
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
   * Register or replace a cohort on a flag for gradual / A/B cohort targeting.
   */
  public upsertCohort(
    flagName: string,
    cohort: {
      id: string;
      name: string;
      percentage?: number;
      members?: string[];
      variantKey?: string;
      forceEnabled?: boolean;
    }
  ): FeatureFlagCohort {
    const flag = this.flags.get(flagName);
    if (!flag) {
      throw new Error(`Flag not found: ${flagName}`);
    }
    if (!flag.cohorts) {
      flag.cohorts = new Map();
    }
    const record: FeatureFlagCohort = {
      id: cohort.id,
      name: cohort.name,
      percentage: cohort.percentage,
      members: new Set(cohort.members ?? []),
      variantKey: cohort.variantKey,
      forceEnabled: cohort.forceEnabled,
    };
    flag.cohorts.set(cohort.id, record);
    return record;
  }

  public removeCohort(flagName: string, cohortId: string): boolean {
    const flag = this.flags.get(flagName);
    return flag?.cohorts?.delete(cohortId) ?? false;
  }

  public listCohorts(flagName: string): FeatureFlagCohort[] {
    const flag = this.flags.get(flagName);
    if (!flag?.cohorts) return [];
    return Array.from(flag.cohorts.values());
  }

  /** Deterministic cohort membership: explicit members or percentage bucket. */
  public isInCohort(flagName: string, cohortId: string, identifier: string): boolean {
    const flag = this.flags.get(flagName);
    const cohort = flag?.cohorts?.get(cohortId);
    if (!cohort) return false;
    if (cohort.members.has(identifier)) return true;
    if (typeof cohort.percentage === "number") {
      const pct = Math.max(0, Math.min(100, cohort.percentage));
      if (pct === 0) return false;
      if (pct === 100) return true;
      const hash = createHash("md5")
        .update(`${flagName}:cohort:${cohortId}:${identifier}`)
        .digest("hex");
      const bucket = (parseInt(hash.substring(0, 4), 16) % 100) + 1;
      return bucket <= pct;
    }
    return false;
  }

  /** First matching cohort for the identifier (stable order by cohort id). */
  public resolveCohort(flagName: string, identifier: string): FeatureFlagCohort | null {
    const flag = this.flags.get(flagName);
    if (!flag?.cohorts || flag.cohorts.size === 0) return null;
    const sorted = Array.from(flag.cohorts.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
    for (const cohort of sorted) {
      if (this.isInCohort(flagName, cohort.id, identifier)) {
        return cohort;
      }
    }
    return null;
  }

  public evaluate(flagName: string, identifier: string = ""): boolean {
    const flag = this.flags.get(flagName);

    const trackAndReturn = (result: boolean) => {
      if (flag) {
        if (result) {
          flag.metrics.servedTrue += 1;
        } else {
          flag.metrics.servedFalse += 1;
        }
      }
      return result;
    };

    if (!flag || !flag.enabled) {
      return trackAndReturn(false);
    }

    if (identifier && flag.targetedUsers.has(identifier)) {
      return trackAndReturn(true);
    }

    const cohort = identifier ? this.resolveCohort(flagName, identifier) : null;
    if (cohort && typeof cohort.forceEnabled === "boolean") {
      return trackAndReturn(cohort.forceEnabled);
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

    const cohort = this.resolveCohort(flagName, identifier);
    if (cohort?.variantKey) {
      const exists = flag.variants.some((v) => v.key === cohort.variantKey);
      if (exists) return cohort.variantKey;
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

  /**
   * Combined cohort-aware evaluation for A/B dashboards and the SDK.
   */
  public evaluateWithCohort(flagName: string, identifier: string): CohortEvaluation {
    const cohort = this.resolveCohort(flagName, identifier);
    const enabled = this.evaluate(flagName, identifier);
    const variant = enabled ? this.evaluateVariant(flagName, identifier) : null;
    return {
      enabled,
      cohortId: cohort?.id ?? null,
      variant,
    };
  }
}

export const featureFlagEngine = new FeatureFlagService();
