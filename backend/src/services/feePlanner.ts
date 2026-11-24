/**
 * Adaptive network-fee planner with per-corridor historical priors (#1326).
 *
 * Each corridor (for example "stellar:USDC->stellar:XLM") keeps a running prior
 * of the network fee it has actually cost: an exponentially weighted mean and
 * variance. A fee plan blends that prior with the live fee quote, trusting the
 * prior more as the corridor accumulates samples. A corridor with no history
 * falls back to a global prior built from every corridor, then to the live
 * quote alone, so a new corridor never gets an invented number.
 *
 * Fees are integers in the smallest unit (stroops, wei, ...). The planner is
 * pure in-memory state with no clock and no I/O, so results are deterministic.
 */

export type FeeUrgency = 'low' | 'normal' | 'high';

export interface FeePlannerConfig {
  /** EWMA smoothing factor in (0, 1]. Higher reacts faster. */
  alpha: number;
  /** Samples after which a corridor prior is trusted as much as the live quote. */
  fullTrustSamples: number;
  /** Standard-deviation multiplier added to the estimate, per urgency. */
  urgencyZ: Record<FeeUrgency, number>;
  /** Hard cap on how far above the live quote a plan may go (1.5 = +50%). */
  maxLiveMultiple: number;
}

export const DEFAULT_FEE_PLANNER_CONFIG: FeePlannerConfig = {
  alpha: 0.2,
  fullTrustSamples: 20,
  urgencyZ: { low: 0, normal: 1, high: 2 },
  maxLiveMultiple: 3,
};

export interface CorridorPrior {
  corridor: string;
  samples: number;
  mean: number;
  variance: number;
}

export type FeePlanSource = 'blended' | 'global-prior' | 'live-only' | 'prior-only';

export interface FeePlan {
  corridor: string;
  urgency: FeeUrgency;
  /** Recommended fee, rounded up to a whole unit. */
  fee: bigint;
  source: FeePlanSource;
  /** Weight given to the historical prior, 0 to 1. */
  priorWeight: number;
  samples: number;
}

export class FeePlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeePlannerError';
  }
}

function assertFee(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new FeePlannerError(`${label} must be a finite, non-negative number`);
  }
}

export class FeePlanner {
  private readonly priors = new Map<string, CorridorPrior>();
  private readonly config: FeePlannerConfig;

  constructor(config: Partial<FeePlannerConfig> = {}) {
    this.config = {
      ...DEFAULT_FEE_PLANNER_CONFIG,
      ...config,
      urgencyZ: { ...DEFAULT_FEE_PLANNER_CONFIG.urgencyZ, ...config.urgencyZ },
    };
    if (!(this.config.alpha > 0 && this.config.alpha <= 1)) {
      throw new FeePlannerError('alpha must be in (0, 1]');
    }
    if (this.config.fullTrustSamples < 1) {
      throw new FeePlannerError('fullTrustSamples must be at least 1');
    }
    if (this.config.maxLiveMultiple < 1) {
      throw new FeePlannerError('maxLiveMultiple must be at least 1');
    }
  }

  /** Record the fee a transfer on this corridor actually paid. */
  observe(corridor: string, paidFee: number): CorridorPrior {
    if (!corridor) throw new FeePlannerError('corridor is required');
    assertFee(paidFee, 'paidFee');

    const prior = this.priors.get(corridor);
    if (!prior) {
      const first: CorridorPrior = { corridor, samples: 1, mean: paidFee, variance: 0 };
      this.priors.set(corridor, first);
      return { ...first };
    }

    // Exponentially weighted mean and variance (West, 1979 form).
    const diff = paidFee - prior.mean;
    const incr = this.config.alpha * diff;
    prior.mean += incr;
    prior.variance = (1 - this.config.alpha) * (prior.variance + diff * incr);
    prior.samples += 1;
    return { ...prior };
  }

  getPrior(corridor: string): CorridorPrior | undefined {
    const prior = this.priors.get(corridor);
    return prior ? { ...prior } : undefined;
  }

  /** Sample-weighted prior across every corridor, or undefined when empty. */
  globalPrior(): CorridorPrior | undefined {
    let samples = 0;
    let mean = 0;
    let variance = 0;
    for (const prior of this.priors.values()) {
      samples += prior.samples;
      mean += prior.mean * prior.samples;
      variance += prior.variance * prior.samples;
    }
    if (samples === 0) return undefined;
    return { corridor: '*', samples, mean: mean / samples, variance: variance / samples };
  }

  /**
   * Plan a fee for a corridor.
   * @param liveFee Current network quote, or undefined when it is unavailable.
   */
  plan(corridor: string, urgency: FeeUrgency, liveFee?: number): FeePlan {
    if (!corridor) throw new FeePlannerError('corridor is required');
    if (!(urgency in this.config.urgencyZ)) throw new FeePlannerError(`unknown urgency: ${urgency}`);
    if (liveFee !== undefined) assertFee(liveFee, 'liveFee');

    const own = this.priors.get(corridor);
    const prior = own ?? this.globalPrior();
    const z = this.config.urgencyZ[urgency];

    if (!prior) {
      if (liveFee === undefined) {
        throw new FeePlannerError('no historical prior and no live fee quote available');
      }
      return this.finish(corridor, urgency, liveFee, 'live-only', 0, 0);
    }

    const stddev = Math.sqrt(prior.variance);
    const priorEstimate = prior.mean + z * stddev;
    // A borrowed global prior is never trusted as much as the corridor's own.
    const maxWeight = own ? 1 : 0.5;
    const priorWeight = Math.min(prior.samples / this.config.fullTrustSamples, 1) * maxWeight;

    if (liveFee === undefined) {
      return this.finish(corridor, urgency, priorEstimate, 'prior-only', 1, prior.samples);
    }

    const blended = priorWeight * priorEstimate + (1 - priorWeight) * (liveFee + z * stddev);
    const capped = Math.min(blended, liveFee * this.config.maxLiveMultiple);
    return this.finish(corridor, urgency, capped, own ? 'blended' : 'global-prior', priorWeight, prior.samples);
  }

  private finish(
    corridor: string,
    urgency: FeeUrgency,
    fee: number,
    source: FeePlanSource,
    priorWeight: number,
    samples: number,
  ): FeePlan {
    return { corridor, urgency, fee: BigInt(Math.ceil(fee)), source, priorWeight, samples };
  }
}
