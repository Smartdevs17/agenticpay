// A/B Testing Framework — Issue #852
// Generic experiment service with deterministic assignment, statistical significance, Bayesian inference.

import { createHash } from 'node:crypto';

export type VariantConfig = {
  key: string;
  name: string;
  weight: number; // 0-100, sum 100
  payload?: unknown;
  isControl?: boolean;
};

export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed' | 'archived';

export interface Experiment {
  id: string;
  name: string;
  description?: string;
  hypothesis?: string;
  variants: Array<VariantConfig & { id: string }>;
  primaryMetric: string;
  secondaryMetrics?: string[];
  trafficAllocation: number; // percent of traffic included 0-100
  status: ExperimentStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  createdBy?: string;
}

export interface Assignment {
  experimentId: string;
  subjectId: string;
  variantId: string;
  variantKey: string;
  assignedAt: string;
  exposed: boolean;
  exposedAt?: string;
}

export interface MetricEvent {
  experimentId: string;
  subjectId: string;
  metric: string;
  value: number; // 1 for binary conversion, numeric for revenue
  timestamp: Date;
}

export interface VariantResult {
  variantId: string;
  key: string;
  name: string;
  isControl: boolean;
  weight: number;
  participants: number;
  exposures: number;
  conversions: number;
  conversionRate: number;
  totalValue: number;
  avgValue: number;
  lift: number | null; // vs control
  relativeLift: number | null;
  pValue: number | null;
  zScore: number | null;
  confidenceInterval: [number, number] | null;
  isWinner: boolean;
  isSignificant: boolean;
}

export interface ExperimentResult {
  experimentId: string;
  status: ExperimentStatus;
  primaryMetric: string;
  variants: VariantResult[];
  winner: string | null;
  sampleSizeRequired: number | null;
  isSampleSizeReached: boolean;
  totalParticipants: number;
  recommendation: string;
  generatedAt: string;
}

// ── Stats helpers ────────────────────────────────────────────────────────────

function hashToBucket(input: string, max: number): number {
  const h = createHash('md5').update(input).digest();
  return h.readUInt32BE(0) % max;
}

// Wilson score interval for binomial proportion
function wilsonInterval(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return [(centre - margin) / denom, (centre + margin) / denom];
}

// Two-proportion z-test (pooled)
function twoProportionZTest(c1: number, n1: number, c2: number, n2: number): { z: number; pValue: number } {
  if (n1 === 0 || n2 === 0) return { z: 0, pValue: 1 };
  const p1 = c1 / n1;
  const p2 = c2 / n2;
  const pPool = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, pValue: 1 };
  const z = (p1 - p2) / se;
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));
  return { z, pValue };
}

function normalCDF(z: number): number {
  // Abramowitz & Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - prob : prob;
}

// Bayesian Beta-Binomial probability that variant beats control
function bayesianProbBeatsControl(a1: number, b1: number, a2: number, b2: number, simulations = 2000): number {
  // Use normal approximation for beta
  // Beta mean = a/(a+b), var = ab/((a+b)^2 (a+b+1))
  const mean1 = a1 / (a1 + b1);
  const mean2 = a2 / (a2 + b2);
  const var1 = (a1 * b1) / ((a1 + b1) ** 2 * (a1 + b1 + 1));
  const var2 = (a2 * b2) / ((a2 + b2) ** 2 * (a2 + b2 + 1));
  const se = Math.sqrt(var1 + var2);
  if (se === 0) return mean1 > mean2 ? 1 : 0;
  const z = (mean1 - mean2) / se;
  return normalCDF(z);
}

function sampleSizeForProportion(baseline: number, mde: number, alpha = 0.05, power = 0.8): number {
  // Two-sided test per variant
  const p1 = baseline;
  const p2 = baseline + mde;
  if (p1 <= 0 || p1 >= 1 || p2 <= 0 || p2 >= 1) return 0;
  const zAlpha = 1.96; // approx for alpha 0.05
  const zBeta = 0.84; // approx for power 0.8
  const pooled = (p1 + p2) / 2;
  const se0 = Math.sqrt(2 * pooled * (1 - pooled));
  const se1 = Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  const n = ((zAlpha * se0 + zBeta * se1) ** 2) / (mde ** 2);
  return Math.ceil(n);
}

export class ABTestingService {
  private experiments = new Map<string, Experiment>();
  private assignments = new Map<string, Assignment>(); // key: expId:subjectId
  private events: MetricEvent[] = [];

  createExperiment(input: {
    id?: string;
    name: string;
    description?: string;
    hypothesis?: string;
    variants: VariantConfig[];
    primaryMetric?: string;
    secondaryMetrics?: string[];
    trafficAllocation?: number;
    createdBy?: string;
  }): Experiment {
    if (!input.name || !input.name.trim()) throw new Error('Experiment name is required');
    if (!Array.isArray(input.variants) || input.variants.length < 2) throw new Error('At least 2 variants required');
    const totalWeight = input.variants.reduce((s, v) => s + v.weight, 0);
    if (Math.abs(totalWeight - 100) > 0.01) throw new Error('Variant weights must sum to 100');
    const keys = input.variants.map((v) => v.key);
    if (new Set(keys).size !== keys.length) throw new Error('Variant keys must be unique');
    if (!keys.every((k) => typeof k === 'string' && k.length > 0)) throw new Error('Each variant must have a key');

    const controls = input.variants.filter((v) => v.isControl).length;
    if (controls > 1) throw new Error('Only one control allowed');

    const id = input.id ?? `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (this.experiments.has(id)) throw new Error(`Experiment ${id} already exists`);

    const variants = input.variants.map((v) => ({
      ...v,
      id: `${id}_${v.key}`,
    }));
    const now = new Date().toISOString();
    const exp: Experiment = {
      id,
      name: input.name,
      description: input.description,
      hypothesis: input.hypothesis,
      variants,
      primaryMetric: input.primaryMetric ?? 'conversion',
      secondaryMetrics: input.secondaryMetrics,
      trafficAllocation: input.trafficAllocation ?? 100,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
    };
    this.experiments.set(id, exp);
    return exp;
  }

  getExperiment(id: string): Experiment | undefined {
    return this.experiments.get(id);
  }

  listExperiments(filter?: { status?: ExperimentStatus }): Experiment[] {
    let list = Array.from(this.experiments.values());
    if (filter?.status) list = list.filter((e) => e.status === filter.status);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  updateExperiment(
    id: string,
    patch: Partial<Pick<Experiment, 'name' | 'description' | 'hypothesis' | 'trafficAllocation'>>,
  ): Experiment | undefined {
    const exp = this.experiments.get(id);
    if (!exp) return undefined;
    if (exp.status !== 'draft') throw new Error('Only draft experiments can be updated');
    if (patch.name !== undefined) exp.name = patch.name;
    if (patch.description !== undefined) exp.description = patch.description;
    if (patch.hypothesis !== undefined) exp.hypothesis = patch.hypothesis;
    if (patch.trafficAllocation !== undefined) exp.trafficAllocation = Math.max(0, Math.min(100, patch.trafficAllocation));
    exp.updatedAt = new Date().toISOString();
    return exp;
  }

  deleteExperiment(id: string): boolean {
    const exp = this.experiments.get(id);
    if (!exp) return false;
    if (exp.status === 'running') throw new Error('Cannot delete running experiment');
    this.experiments.delete(id);
    // remove assignments/events
    for (const k of Array.from(this.assignments.keys())) if (k.startsWith(`${id}:`)) this.assignments.delete(k);
    this.events = this.events.filter((e) => e.experimentId !== id);
    return true;
  }

  startExperiment(id: string): Experiment {
    const exp = this.experiments.get(id);
    if (!exp) throw new Error(`Experiment ${id} not found`);
    if (exp.status !== 'draft' && exp.status !== 'paused') throw new Error('Only draft/paused can be started');
    exp.status = 'running';
    exp.startedAt = new Date().toISOString();
    exp.updatedAt = new Date().toISOString();
    return exp;
  }

  pauseExperiment(id: string): Experiment {
    const exp = this.experiments.get(id);
    if (!exp) throw new Error(`Experiment ${id} not found`);
    if (exp.status !== 'running') throw new Error('Only running can be paused');
    exp.status = 'paused';
    exp.updatedAt = new Date().toISOString();
    return exp;
  }

  completeExperiment(id: string): Experiment {
    const exp = this.experiments.get(id);
    if (!exp) throw new Error(`Experiment ${id} not found`);
    if (exp.status !== 'running' && exp.status !== 'paused') throw new Error('Only running/paused can be completed');
    exp.status = 'completed';
    exp.endedAt = new Date().toISOString();
    exp.updatedAt = new Date().toISOString();
    return exp;
  }

  archiveExperiment(id: string): Experiment {
    const exp = this.experiments.get(id);
    if (!exp) throw new Error(`Experiment ${id} not found`);
    exp.status = 'archived';
    exp.updatedAt = new Date().toISOString();
    return exp;
  }

  assign(experimentId: string, subjectId: string): { variant: Experiment['variants'][number]; assignment: Assignment } {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);
    if (!subjectId || typeof subjectId !== 'string') throw new Error('subjectId required');
    const key = `${experimentId}:${subjectId}`;
    const existing = this.assignments.get(key);
    if (existing) {
      const variant = exp.variants.find((v) => v.id === existing.variantId)!;
      return { variant, assignment: existing };
    }
    // traffic allocation gate
    const trafficBucket = hashToBucket(`${experimentId}:traffic:${subjectId}`, 100);
    if (trafficBucket >= exp.trafficAllocation) {
      // not included -> assign control if exists else first
      const control = exp.variants.find((v) => v.isControl) ?? exp.variants[0];
      const assignment: Assignment = {
        experimentId,
        subjectId,
        variantId: control.id,
        variantKey: control.key,
        assignedAt: new Date().toISOString(),
        exposed: false,
      };
      this.assignments.set(key, assignment);
      return { variant: control, assignment };
    }

    // weighted assignment
    const bucket = hashToBucket(`${experimentId}:${subjectId}`, 100) + 1; // 1..100
    let acc = 0;
    let chosen = exp.variants[exp.variants.length - 1];
    for (const v of exp.variants) {
      acc += v.weight;
      if (bucket <= acc) {
        chosen = v;
        break;
      }
    }
    const assignment: Assignment = {
      experimentId,
      subjectId,
      variantId: chosen.id,
      variantKey: chosen.key,
      assignedAt: new Date().toISOString(),
      exposed: false,
    };
    this.assignments.set(key, assignment);
    return { variant: chosen, assignment };
  }

  recordExposure(experimentId: string, subjectId: string): Assignment | undefined {
    const key = `${experimentId}:${subjectId}`;
    const a = this.assignments.get(key);
    if (!a) return undefined;
    if (!a.exposed) {
      a.exposed = true;
      a.exposedAt = new Date().toISOString();
    }
    return a;
  }

  trackEvent(input: { experimentId: string; subjectId: string; metric?: string; value?: number; timestamp?: Date }): MetricEvent {
    const exp = this.experiments.get(input.experimentId);
    if (!exp) throw new Error(`Experiment ${input.experimentId} not found`);
    const assignmentKey = `${input.experimentId}:${input.subjectId}`;
    if (!this.assignments.has(assignmentKey)) {
      // auto-assign if not assigned
      this.assign(input.experimentId, input.subjectId);
    }
    const ev: MetricEvent = {
      experimentId: input.experimentId,
      subjectId: input.subjectId,
      metric: input.metric ?? exp.primaryMetric,
      value: typeof input.value === 'number' ? input.value : 1,
      timestamp: input.timestamp ?? new Date(),
    };
    this.events.push(ev);
    return ev;
  }

  getResults(experimentId: string): ExperimentResult {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);

    const assignments = Array.from(this.assignments.values()).filter((a) => a.experimentId === experimentId);
    const totalParticipants = assignments.length;

    // control variant
    const control = exp.variants.find((v) => v.isControl) ?? exp.variants[0];

    // per variant aggregations for primaryMetric
    const variantEvents = new Map<string, MetricEvent[]>();
    for (const ev of this.events) {
      if (ev.experimentId !== experimentId) continue;
      if (ev.metric !== exp.primaryMetric) continue;
      const key = `${experimentId}:${ev.subjectId}`;
      const assignment = this.assignments.get(key);
      if (!assignment) continue;
      const list = variantEvents.get(assignment.variantId) ?? [];
      list.push(ev);
      variantEvents.set(assignment.variantId, list);
    }

    // dedupe conversions per subject: binary conversion if any event with value>0
    // For binary metric, count unique subjects with conversion
    const variantStats = new Map<string, { conversions: number; totalValue: number }>();
    for (const [variantId, evs] of variantEvents) {
      const bySubject = new Map<string, number>();
      for (const e of evs) {
        const prev = bySubject.get(e.subjectId) ?? 0;
        // sum values per subject (for revenue) but cap conversion binary
        bySubject.set(e.subjectId, prev + e.value);
      }
      // for conversion rate, consider subject converted if value >=1
      let conversions = 0;
      let totalValue = 0;
      for (const [, val] of bySubject) {
        totalValue += val;
        if (val > 0) conversions += 1;
      }
      variantStats.set(variantId, { conversions, totalValue });
    }

    const controlAssignments = assignments.filter((a) => a.variantId === control.id);
    const controlN = controlAssignments.length;
    const controlData = variantStats.get(control.id) ?? { conversions: 0, totalValue: 0 };
    const controlRate = controlN > 0 ? controlData.conversions / controlN : 0;

    const results: VariantResult[] = exp.variants.map((v) => {
      const assigns = assignments.filter((a) => a.variantId === v.id);
      const exposures = assigns.filter((a) => a.exposed).length;
      const n = assigns.length;
      const data = variantStats.get(v.id) ?? { conversions: 0, totalValue: 0 };
      const convRate = n > 0 ? data.conversions / n : 0;
      const avgValue = n > 0 ? data.totalValue / n : 0;

      let lift: number | null = null;
      let relativeLift: number | null = null;
      let pValue: number | null = null;
      let zScore: number | null = null;
      let ci: [number, number] | null = null;

      if (v.id !== control.id) {
        lift = convRate - controlRate;
        relativeLift = controlRate > 0 ? (convRate - controlRate) / controlRate : null;
        const { z, pValue: p } = twoProportionZTest(data.conversions, n, controlData.conversions, controlN);
        zScore = z;
        pValue = p;
      }
      // Wilson CI
      ci = wilsonInterval(data.conversions, n);

      const isSignificant = pValue !== null ? pValue < 0.05 : false;
      // Winner check will be done after
      return {
        variantId: v.id,
        key: v.key,
        name: v.name,
        isControl: !!v.isControl,
        weight: v.weight,
        participants: n,
        exposures,
        conversions: data.conversions,
        conversionRate: convRate,
        totalValue: data.totalValue,
        avgValue,
        lift,
        relativeLift,
        pValue,
        zScore,
        confidenceInterval: ci,
        isWinner: false,
        isSignificant,
      };
    });

    // Determine winner: highest conversionRate among significant variants, else highest rate if not significant but completed?
    let winner: string | null = null;
    const significant = results.filter((r) => !r.isControl && r.isSignificant && r.lift !== null && r.lift > 0);
    if (significant.length > 0) {
      const best = significant.sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0))[0];
      winner = best.key;
      for (const r of results) if (r.key === winner) r.isWinner = true;
    } else if (exp.status === 'completed') {
      // No significance, pick best lift but mark not winner
      const sorted = [...results.filter((r) => !r.isControl)].sort((a, b) => b.conversionRate - a.conversionRate);
      if (sorted.length && sorted[0].conversionRate > controlRate) {
        // winner null because not significant
      }
    }

    // Bayesian prob for best variant
    // Could compute but not needed for winner logic; recommendation string
    let recommendation = 'Continue experiment: not enough data or no significant winner.';
    if (winner) recommendation = `Variant ${winner} is winner with significant lift. Recommend rollout.`;
    else if (exp.status === 'completed' && totalParticipants > 0) {
      const bestLift = Math.max(...results.filter((r) => !r.isControl).map((r) => r.lift ?? -Infinity));
      if (bestLift > 0) recommendation = 'No statistically significant winner yet. Consider extending runtime or increasing sample.';
      else recommendation = 'Control is best or no difference detected. Keep control.';
    }

    const required = sampleSizeForProportion(controlRate || 0.1, 0.02);
    const isSampleSizeReached = totalParticipants >= required * exp.variants.length;

    return {
      experimentId,
      status: exp.status,
      primaryMetric: exp.primaryMetric,
      variants: results,
      winner,
      sampleSizeRequired: required,
      isSampleSizeReached,
      totalParticipants,
      recommendation,
      generatedAt: new Date().toISOString(),
    };
  }

  calculateSampleSize(baselineRate: number, mde: number, alpha = 0.05, power = 0.8): number {
    return sampleSizeForProportion(baselineRate, mde, alpha, power);
  }

  // For testing/bayesian
  getBayesianProb(experimentId: string): Record<string, number> | null {
    const exp = this.experiments.get(experimentId);
    if (!exp) return null;
    const results = this.getResults(experimentId);
    const control = results.variants.find((v) => v.isControl);
    if (!control) return null;
    const out: Record<string, number> = {};
    const aCtrl = control.conversions + 1;
    const bCtrl = control.participants - control.conversions + 1;
    for (const v of results.variants) {
      if (v.isControl) continue;
      const a = v.conversions + 1;
      const b = v.participants - v.conversions + 1;
      out[v.key] = bayesianProbBeatsControl(a, b, aCtrl, bCtrl);
    }
    return out;
  }

  resetForTests(): void {
    this.experiments.clear();
    this.assignments.clear();
    this.events = [];
  }
}

export const abTestingService = new ABTestingService();
export { bayesianProbBeatsControl, twoProportionZTest, wilsonInterval, sampleSizeForProportion };
