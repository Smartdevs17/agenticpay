/**
 * cold-start.ts
 *
 * Tracks cold start events and per-request latency for serverless-style
 * deployments. Exposes metrics consumed by the cold-start monitoring dashboard.
 *
 * A "cold start" is defined as the first request handled after the process
 * started (or after a configurable idle gap that would cause a new instance
 * to be spun up in a serverless environment).
 */

import { Request, Response, NextFunction } from 'express';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ColdStartEvent {
  timestamp: number;
  initDurationMs: number;   // time from process.hrtime start to first request
  path: string;
  method: string;
}

export interface RequestLatencySample {
  path: string;
  durationMs: number;
  timestamp: number;
  wasColdStart: boolean;
}

export interface ColdStartMetrics {
  processStartedAt: number;
  firstRequestAt: number | null;
  initDurationMs: number | null;
  coldStartCount: number;
  totalRequests: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  recentColdStarts: ColdStartEvent[];
  recentSamples: RequestLatencySample[];
}

// ── State ─────────────────────────────────────────────────────────────────────

const PROCESS_START_NS = process.hrtime.bigint();
const PROCESS_START_MS = Date.now();

// Idle gap: if no request is received for this long, the next request is
// treated as a cold start (simulates serverless instance recycling).
const IDLE_COLD_START_THRESHOLD_MS = Number(process.env.COLD_START_IDLE_THRESHOLD_MS ?? 300_000); // 5 min

// Rolling window for latency percentile calculation
const MAX_SAMPLES = 1000;
const MAX_COLD_START_HISTORY = 50;

let firstRequestAt: number | null = null;
let lastRequestAt: number | null = null;
let coldStartCount = 0;
let totalRequests = 0;

const latencySamples: RequestLatencySample[] = [];
const coldStartHistory: ColdStartEvent[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, idx)];
}

function recordSample(sample: RequestLatencySample): void {
  latencySamples.push(sample);
  if (latencySamples.length > MAX_SAMPLES) {
    latencySamples.shift();
  }
}

function isColdStart(): boolean {
  if (firstRequestAt === null) return true;
  if (lastRequestAt !== null && Date.now() - lastRequestAt > IDLE_COLD_START_THRESHOLD_MS) {
    return true;
  }
  return false;
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Express middleware that measures per-request latency and detects cold starts.
 * Mount this early in the middleware chain, before route handlers.
 */
export function coldStartMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestStart = Date.now();
  const wasCold = isColdStart();

  totalRequests++;

  if (wasCold) {
    coldStartCount++;
    // For the very first request: measure time from process start to now.
    // For idle-gap cold starts: measure time since the last request (idle gap).
    const initDurationMs = firstRequestAt === null
      ? Number((process.hrtime.bigint() - PROCESS_START_NS) / 1_000_000n)
      : requestStart - (lastRequestAt ?? requestStart);

    if (firstRequestAt === null) {
      firstRequestAt = requestStart;
    }

    const event: ColdStartEvent = {
      timestamp: requestStart,
      initDurationMs,
      path: req.path,
      method: req.method,
    };

    coldStartHistory.push(event);
    if (coldStartHistory.length > MAX_COLD_START_HISTORY) {
      coldStartHistory.shift();
    }

    console.warn(
      `[cold-start] Cold start detected — init: ${initDurationMs}ms, path: ${req.method} ${req.path}`
    );
  }

  lastRequestAt = requestStart;

  res.on('finish', () => {
    const durationMs = Date.now() - requestStart;
    recordSample({
      path: req.path,
      durationMs,
      timestamp: requestStart,
      wasColdStart: wasCold,
    });
  });

  next();
}

// ── Metrics snapshot ──────────────────────────────────────────────────────────

export function getColdStartMetrics(): ColdStartMetrics {
  const sorted = [...latencySamples]
    .map((s) => s.durationMs)
    .sort((a, b) => a - b);

  const initDurationMs = firstRequestAt !== null
    ? firstRequestAt - PROCESS_START_MS
    : null;

  return {
    processStartedAt: PROCESS_START_MS,
    firstRequestAt,
    initDurationMs,
    coldStartCount,
    totalRequests,
    p50LatencyMs: percentile(sorted, 50),
    p95LatencyMs: percentile(sorted, 95),
    p99LatencyMs: percentile(sorted, 99),
    recentColdStarts: [...coldStartHistory].reverse().slice(0, 10),
    recentSamples: [...latencySamples].reverse().slice(0, 20),
  };
}

export function resetColdStartMetrics(): void {
  firstRequestAt = null;
  lastRequestAt = null;
  coldStartCount = 0;
  totalRequests = 0;
  latencySamples.length = 0;
  coldStartHistory.length = 0;
}
