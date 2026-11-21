// Funnel Conversion Tracking — Issue #853
// Tracks custom funnels with step definitions, conversion rates, drop-offs, time-to-convert and cohort windows.

export interface FunnelStepDefinition {
  id: string;
  name: string;
  order: number;
  description?: string;
}

export interface FunnelDefinition {
  id: string;
  name: string;
  description?: string;
  steps: FunnelStepDefinition[];
  conversionWindowMs: number; // max time between first and last step to count as converted
  createdAt: string;
  updatedAt: string;
}

export interface FunnelEvent {
  funnelId: string;
  userId: string;
  stepId: string;
  timestamp: Date;
  properties?: Record<string, unknown>;
  sessionId?: string;
}

export interface FunnelStepStats {
  stepId: string;
  stepName: string;
  order: number;
  entered: number;
  completed: number;
  dropOff: number;
  dropOffRate: number;
  conversionRate: number; // vs first step
  stepConversionRate: number; // vs previous step
  avgTimeToNextMs: number | null;
  medianTimeToNextMs: number | null;
  p95TimeToNextMs: number | null;
}

export interface FunnelStats {
  funnelId: string;
  funnelName: string;
  totalUsers: number;
  totalConverted: number;
  overallConversionRate: number;
  steps: FunnelStepStats[];
  avgTotalConversionTimeMs: number | null;
  medianTotalConversionTimeMs: number | null;
  generatedAt: string;
}

export interface UserJourney {
  userId: string;
  funnelId: string;
  steps: Array<{ stepId: string; timestamp: string }>;
  completed: boolean;
  conversionTimeMs: number | null;
  currentStep: string | null;
  droppedAt: string | null;
}

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export class FunnelTrackingService {
  private funnels = new Map<string, FunnelDefinition>();
  private events: FunnelEvent[] = [];

  createFunnel(input: {
    id?: string;
    name: string;
    description?: string;
    steps: Array<{ id: string; name: string; description?: string }>;
    conversionWindowMs?: number;
  }): FunnelDefinition {
    if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
      throw new Error('Funnel name is required');
    }
    if (!Array.isArray(input.steps) || input.steps.length < 2) {
      throw new Error('Funnel must have at least 2 steps');
    }
    const ids = input.steps.map((s) => s.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error('Funnel step ids must be unique');
    }
    if (ids.some((id) => !id || typeof id !== 'string')) {
      throw new Error('Each step must have a valid id');
    }
    const id = input.id ?? `funnel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (this.funnels.has(id)) throw new Error(`Funnel ${id} already exists`);
    const steps: FunnelStepDefinition[] = input.steps.map((s, idx) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      order: idx,
    }));
    const funnel: FunnelDefinition = {
      id,
      name: input.name,
      description: input.description,
      steps,
      conversionWindowMs: input.conversionWindowMs ?? DEFAULT_WINDOW_MS,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.funnels.set(id, funnel);
    return funnel;
  }

  getFunnel(funnelId: string): FunnelDefinition | undefined {
    return this.funnels.get(funnelId);
  }

  listFunnels(): FunnelDefinition[] {
    return Array.from(this.funnels.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  updateFunnel(
    funnelId: string,
    patch: Partial<Pick<FunnelDefinition, 'name' | 'description' | 'conversionWindowMs'>>,
  ): FunnelDefinition | undefined {
    const f = this.funnels.get(funnelId);
    if (!f) return undefined;
    if (patch.name !== undefined) f.name = patch.name;
    if (patch.description !== undefined) f.description = patch.description;
    if (patch.conversionWindowMs !== undefined) f.conversionWindowMs = patch.conversionWindowMs;
    f.updatedAt = new Date().toISOString();
    return f;
  }

  deleteFunnel(funnelId: string): boolean {
    const deleted = this.funnels.delete(funnelId);
    if (deleted) {
      this.events = this.events.filter((e) => e.funnelId !== funnelId);
    }
    return deleted;
  }

  track(event: Omit<FunnelEvent, 'timestamp'> & { timestamp?: Date | string }): FunnelEvent {
    const funnel = this.funnels.get(event.funnelId);
    if (!funnel) throw new Error(`Funnel ${event.funnelId} not found`);
    if (!event.userId || typeof event.userId !== 'string') throw new Error('userId is required');
    if (!event.stepId || typeof event.stepId !== 'string') throw new Error('stepId is required');
    if (!funnel.steps.some((s) => s.id === event.stepId)) {
      throw new Error(`Step ${event.stepId} not in funnel ${event.funnelId}`);
    }
    let ts: Date;
    if (event.timestamp instanceof Date) ts = event.timestamp;
    else if (typeof event.timestamp === 'string') {
      ts = new Date(event.timestamp);
      if (Number.isNaN(ts.getTime())) throw new Error('Invalid timestamp');
    } else {
      ts = new Date();
    }
    const record: FunnelEvent = {
      funnelId: event.funnelId,
      userId: event.userId,
      stepId: event.stepId,
      timestamp: ts,
      properties: event.properties,
      sessionId: event.sessionId,
    };
    this.events.push(record);
    // keep last 30 days
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    this.events = this.events.filter((e) => e.timestamp.getTime() > cutoff);
    return record;
  }

  getUserJourney(userId: string, funnelId: string): UserJourney | null {
    const funnel = this.funnels.get(funnelId);
    if (!funnel) return null;
    const userEvents = this.events
      .filter((e) => e.funnelId === funnelId && e.userId === userId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    if (userEvents.length === 0) return null;

    // deduplicate to first occurrence per step in order
    const stepMap = new Map<string, Date>();
    for (const ev of userEvents) {
      if (!stepMap.has(ev.stepId)) stepMap.set(ev.stepId, ev.timestamp);
    }

    const orderedSteps = funnel.steps
      .filter((s) => stepMap.has(s.id))
      .map((s) => ({ stepId: s.id, timestamp: stepMap.get(s.id)!.toISOString() }));

    // check if funnel ordering is respected with window
    let completed = false;
    let conversionTimeMs: number | null = null;
    let currentStep: string | null = null;
    let droppedAt: string | null = null;

    // journey is completed if user has all steps in order within window and timestamps increasing
    const firstTs = stepMap.get(funnel.steps[0].id);
    const lastTs = stepMap.get(funnel.steps[funnel.steps.length - 1].id);
    if (firstTs && lastTs) {
      // verify order: each step timestamp > previous
      let inOrder = true;
      for (let i = 1; i < funnel.steps.length; i++) {
        const prev = stepMap.get(funnel.steps[i - 1].id);
        const cur = stepMap.get(funnel.steps[i].id);
        if (!prev || !cur || cur.getTime() < prev.getTime()) {
          inOrder = false;
          break;
        }
      }
      if (inOrder && lastTs.getTime() - firstTs.getTime() <= funnel.conversionWindowMs) {
        completed = true;
        conversionTimeMs = lastTs.getTime() - firstTs.getTime();
        currentStep = funnel.steps[funnel.steps.length - 1].id;
      } else {
        // find last completed sequential step
        for (let i = orderedSteps.length - 1; i >= 0; i--) {
          currentStep = funnel.steps.find((s) => s.id === orderedSteps[i].stepId)?.id ?? null;
          break;
        }
        droppedAt = orderedSteps[orderedSteps.length - 1]?.timestamp ?? null;
      }
    } else {
      // not completed
      const lastStep = orderedSteps[orderedSteps.length - 1];
      currentStep = lastStep?.stepId ?? null;
      droppedAt = lastStep?.timestamp ?? null;
    }

    return {
      userId,
      funnelId,
      steps: orderedSteps,
      completed,
      conversionTimeMs,
      currentStep,
      droppedAt,
    };
  }

  getFunnelStats(
    funnelId: string,
    opts: { since?: Date; until?: Date; conversionWindowMs?: number } = {},
  ): FunnelStats {
    const funnel = this.funnels.get(funnelId);
    if (!funnel) throw new Error(`Funnel ${funnelId} not found`);
    const windowMs = opts.conversionWindowMs ?? funnel.conversionWindowMs;

    let filtered = this.events.filter((e) => e.funnelId === funnelId);
    if (opts.since) filtered = filtered.filter((e) => e.timestamp >= opts.since!);
    if (opts.until) filtered = filtered.filter((e) => e.timestamp <= opts.until!);

    // group by user, keep earliest per step
    const userSteps = new Map<string, Map<string, Date>>();
    for (const ev of filtered) {
      if (!userSteps.has(ev.userId)) userSteps.set(ev.userId, new Map());
      const m = userSteps.get(ev.userId)!;
      if (!m.has(ev.stepId) || ev.timestamp < m.get(ev.stepId)!) {
        m.set(ev.stepId, ev.timestamp);
      }
    }

    const totalUsers = userSteps.size;
    let totalConverted = 0;
    const conversionTimes: number[] = [];
    const stepTimes: Map<string, number[]> = new Map(); // stepId -> time to next

    // per step counts: how many users entered step (with ordering constraint)
    const stepEntered: number[] = funnel.steps.map(() => 0);

    for (const [, steps] of userSteps) {
      // check sequential progress: user must have steps in order
      let lastTs: Date | null = null;
      let seqIdx = 0;
      // find furthest sequential step within window
      for (let i = 0; i < funnel.steps.length; i++) {
        const sid = funnel.steps[i].id;
        const ts = steps.get(sid);
        if (!ts) break;
        if (lastTs && ts.getTime() < lastTs.getTime()) break; // out of order
        // window check from first step
        const firstTs = steps.get(funnel.steps[0].id);
        if (firstTs && ts.getTime() - firstTs.getTime() > windowMs) break;
        stepEntered[i] += 1;
        if (lastTs) {
          const diff = ts.getTime() - lastTs.getTime();
          const key = funnel.steps[i - 1].id;
          if (!stepTimes.has(key)) stepTimes.set(key, []);
          stepTimes.get(key)!.push(diff);
        }
        lastTs = ts;
        seqIdx = i;
      }
      // check if converted (all steps)
      if (seqIdx === funnel.steps.length - 1 && stepEntered[funnel.steps.length - 1] > 0) {
        // verify this user counted as entered last step means they completed
        const first = steps.get(funnel.steps[0].id)!;
        const last = steps.get(funnel.steps[funnel.steps.length - 1].id)!;
        if (last.getTime() >= first.getTime() && last.getTime() - first.getTime() <= windowMs) {
          totalConverted += 1;
          conversionTimes.push(last.getTime() - first.getTime());
        }
      }
    }

    // Adjust totalConverted double counting: we incremented inside loop but stepEntered tracks correctly.
    // However totalConverted counted per user that reached last step sequentially; recompute properly:
    // The above totalConverted is correct because we only increment when seq reaches last.
    // But we need to ensure stepEntered last equals totalConverted
    // (already if all sequential)
    const firstStepCount = stepEntered[0] || 1; // avoid div by zero

    const steps: FunnelStepStats[] = funnel.steps.map((s, idx) => {
      const entered = stepEntered[idx];
      const prevEntered = idx === 0 ? firstStepCount : stepEntered[idx - 1];
      const completed = entered;
      const dropOff = prevEntered - entered;
      const dropOffRate = prevEntered > 0 ? dropOff / prevEntered : 0;
      const conversionRate = firstStepCount > 0 ? entered / firstStepCount : 0;
      const stepConversionRate = prevEntered > 0 ? entered / prevEntered : idx === 0 ? 1 : 0;
      const times = stepTimes.get(s.id) ?? [];
      const sorted = [...times].sort((a, b) => a - b);
      return {
        stepId: s.id,
        stepName: s.name,
        order: s.order,
        entered,
        completed,
        dropOff: Math.max(0, dropOff),
        dropOffRate,
        conversionRate,
        stepConversionRate,
        avgTimeToNextMs: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
        medianTimeToNextMs: percentile(sorted, 50),
        p95TimeToNextMs: percentile(sorted, 95),
      };
    });

    const sortedConv = [...conversionTimes].sort((a, b) => a - b);
    return {
      funnelId,
      funnelName: funnel.name,
      totalUsers,
      totalConverted,
      overallConversionRate: totalUsers > 0 ? totalConverted / totalUsers : 0,
      steps,
      avgTotalConversionTimeMs: sortedConv.length ? sortedConv.reduce((a, b) => a + b, 0) / sortedConv.length : null,
      medianTotalConversionTimeMs: percentile(sortedConv, 50),
      generatedAt: new Date().toISOString(),
    };
  }

  getTopDropOff(stats: FunnelStats): FunnelStepStats | null {
    if (stats.steps.length < 2) return null;
    return [...stats.steps].sort((a, b) => b.dropOffRate - a.dropOffRate)[0] ?? null;
  }

  exportCsv(funnelId: string, opts: { since?: Date; until?: Date } = {}): string {
    const stats = this.getFunnelStats(funnelId, opts);
    const header = 'stepId,stepName,order,entered,conversionRate,stepConversionRate,dropOff,dropOffRate,avgTimeToNextMs';
    const rows = stats.steps.map(
      (s) =>
        `${s.stepId},${s.stepName},${s.order},${s.entered},${(s.conversionRate * 100).toFixed(2)}%,${(s.stepConversionRate * 100).toFixed(2)}%,${s.dropOff},${(s.dropOffRate * 100).toFixed(2)}%,${s.avgTimeToNextMs ?? ''}`,
    );
    return [header, ...rows].join('\n');
  }

  resetForTests(): void {
    this.funnels.clear();
    this.events = [];
  }
}

export const funnelTrackingService = new FunnelTrackingService();
