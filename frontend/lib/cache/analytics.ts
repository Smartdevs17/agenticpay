type CacheStatus = "miss" | "hit" | "stale";

export interface CacheObservation {
  key: string;
  status: CacheStatus;
  generatedAt: string;
  servedAt: string;
}

interface CacheMetric {
  key: string;
  hits: number;
  misses: number;
  staleServes: number;
  lastGeneratedAt: string;
  lastServedAt: string;
}

const metrics = new Map<string, CacheMetric>();
const recentEvents: CacheObservation[] = [];
const RECENT_EVENT_LIMIT = 100;

export function recordCacheObservation(observation: CacheObservation) {
  const current = metrics.get(observation.key) ?? {
    key: observation.key,
    hits: 0,
    misses: 0,
    staleServes: 0,
    lastGeneratedAt: observation.generatedAt,
    lastServedAt: observation.servedAt,
  };

  if (observation.status === "hit") current.hits += 1;
  if (observation.status === "miss") current.misses += 1;
  if (observation.status === "stale") current.staleServes += 1;

  current.lastGeneratedAt = observation.generatedAt;
  current.lastServedAt = observation.servedAt;
  metrics.set(observation.key, current);

  recentEvents.unshift(observation);
  if (recentEvents.length > RECENT_EVENT_LIMIT) {
    recentEvents.length = RECENT_EVENT_LIMIT;
  }
}

export function getCacheAnalyticsSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    totals: Array.from(metrics.values()).reduce(
      (summary, metric) => {
        summary.keys += 1;
        summary.hits += metric.hits;
        summary.misses += metric.misses;
        summary.staleServes += metric.staleServes;
        return summary;
      },
      { keys: 0, hits: 0, misses: 0, staleServes: 0 }
    ),
    metrics: Array.from(metrics.values()).sort((left, right) => left.key.localeCompare(right.key)),
    recentEvents,
  };
}

