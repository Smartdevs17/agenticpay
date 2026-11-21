import { Router, Request, Response } from 'express';
import {
  getAnalyticsSummary,
  analyticsEvents as _analyticsEvents,
  type RateLimitEvent,
} from '../middleware/rate-limit.js';

export const rateLimitAnalyticsRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/v1/rate-limit/analytics
// ---------------------------------------------------------------------------

/**
 * Returns a high-level summary of rate-limit activity for the requested
 * time window.
 *
 * Query params:
 *   windowMs  — look-back window in ms (default: 60000)
 */
rateLimitAnalyticsRouter.get('/analytics', (req: Request, res: Response) => {
  const windowMs = Number(req.query['windowMs']) || 60_000;
  const summary = getAnalyticsSummary(windowMs);
  res.json({ data: summary });
});

// ---------------------------------------------------------------------------
// GET /api/v1/rate-limit/analytics/top-blocked
// ---------------------------------------------------------------------------

/**
 * Returns the top N most-blocked client keys in the requested window.
 *
 * Query params:
 *   windowMs  — look-back window in ms (default: 60000)
 *   limit     — number of results (default: 10, max: 100)
 */
rateLimitAnalyticsRouter.get('/analytics/top-blocked', (req: Request, res: Response) => {
  const windowMs = Number(req.query['windowMs']) || 60_000;
  const limit = Math.min(Number(req.query['limit']) || 10, 100);
  const cutoff = Date.now() - windowMs;

  const events = getRecentEvents(cutoff).filter((e) => !e.allowed);

  const byKey: Record<string, { key: string; tier: string; count: number }> = {};
  for (const e of events) {
    byKey[e.key] ??= { key: e.key, tier: e.tier, count: 0 };
    byKey[e.key].count++;
  }

  const sorted = Object.values(byKey)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  res.json({ data: sorted, windowMs, total: sorted.length });
});

// ---------------------------------------------------------------------------
// GET /api/v1/rate-limit/analytics/trends
// ---------------------------------------------------------------------------

/**
 * Returns request counts bucketed into time intervals for trend graphing.
 *
 * Query params:
 *   windowMs    — total look-back window in ms (default: 3600000 = 1 hour)
 *   buckets     — number of time buckets (default: 12)
 */
rateLimitAnalyticsRouter.get('/analytics/trends', (req: Request, res: Response) => {
  const windowMs = Number(req.query['windowMs']) || 60 * 60 * 1_000;
  const bucketCount = Math.min(Math.max(Number(req.query['buckets']) || 12, 1), 60);
  const bucketMs = Math.floor(windowMs / bucketCount);
  const now = Date.now();
  const cutoff = now - windowMs;

  const events = getRecentEvents(cutoff);

  const buckets: { startMs: number; total: number; blocked: number }[] = Array.from(
    { length: bucketCount },
    (_, i) => ({ startMs: cutoff + i * bucketMs, total: 0, blocked: 0 }),
  );

  for (const e of events) {
    const idx = Math.min(Math.floor((e.ts - cutoff) / bucketMs), bucketCount - 1);
    if (idx >= 0) {
      buckets[idx].total++;
      if (!e.allowed) buckets[idx].blocked++;
    }
  }

  res.json({
    data: buckets.map((b) => ({
      timestamp: new Date(b.startMs).toISOString(),
      total: b.total,
      blocked: b.blocked,
      allowed: b.total - b.blocked,
    })),
    windowMs,
    bucketMs,
    buckets: bucketCount,
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/rate-limit/analytics/per-key
// ---------------------------------------------------------------------------

/**
 * Returns per-client-key breakdown — totals, blocks, current tier.
 *
 * Query params:
 *   windowMs  — look-back window in ms (default: 60000)
 *   limit     — max results (default: 50, max: 500)
 */
rateLimitAnalyticsRouter.get('/analytics/per-key', (req: Request, res: Response) => {
  const windowMs = Number(req.query['windowMs']) || 60_000;
  const limit = Math.min(Number(req.query['limit']) || 50, 500);
  const cutoff = Date.now() - windowMs;

  const events = getRecentEvents(cutoff);
  const byKey: Record<string, { key: string; tier: string; total: number; blocked: number; allowRate: number }> = {};

  for (const e of events) {
    byKey[e.key] ??= { key: e.key, tier: e.tier, total: 0, blocked: 0, allowRate: 1 };
    byKey[e.key].total++;
    if (!e.allowed) byKey[e.key].blocked++;
  }

  for (const entry of Object.values(byKey)) {
    entry.allowRate = entry.total > 0 ? (entry.total - entry.blocked) / entry.total : 1;
  }

  const sorted = Object.values(byKey)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);

  res.json({ data: sorted, windowMs, total: sorted.length });
});

// ---------------------------------------------------------------------------
// Helper — access the module-level analytics ring buffer
// ---------------------------------------------------------------------------

function getRecentEvents(cutoffMs: number): RateLimitEvent[] {
  return (_analyticsEvents as RateLimitEvent[]).filter((e) => e.ts >= cutoffMs);
}
