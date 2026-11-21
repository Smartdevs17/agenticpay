export interface OutboxMetricsSnapshot {
  queueDepth: number;
  published: number;
  failed: number;
  deadLettered: number;
  cleaned: number;
  lastPublishLatencyMs: number;
  averagePublishLatencyMs: number;
  failureRate: number;
}

const metrics = {
  queueDepth: 0,
  published: 0,
  failed: 0,
  deadLettered: 0,
  cleaned: 0,
  latencyTotalMs: 0,
  latencySamples: 0,
  lastPublishLatencyMs: 0,
};

export function setOutboxQueueDepth(depth: number): void {
  metrics.queueDepth = depth;
}

export function recordOutboxPublished(latencyMs: number): void {
  metrics.published += 1;
  metrics.lastPublishLatencyMs = latencyMs;
  metrics.latencyTotalMs += latencyMs;
  metrics.latencySamples += 1;
}

export function recordOutboxFailure(): void {
  metrics.failed += 1;
}

export function recordOutboxDeadLetter(): void {
  metrics.deadLettered += 1;
}

export function recordOutboxCleanup(count: number): void {
  metrics.cleaned += count;
}

export function getOutboxMetrics(): OutboxMetricsSnapshot {
  const attempts = metrics.published + metrics.failed;
  return {
    queueDepth: metrics.queueDepth,
    published: metrics.published,
    failed: metrics.failed,
    deadLettered: metrics.deadLettered,
    cleaned: metrics.cleaned,
    lastPublishLatencyMs: metrics.lastPublishLatencyMs,
    averagePublishLatencyMs:
      metrics.latencySamples === 0 ? 0 : metrics.latencyTotalMs / metrics.latencySamples,
    failureRate: attempts === 0 ? 0 : metrics.failed / attempts,
  };
}
