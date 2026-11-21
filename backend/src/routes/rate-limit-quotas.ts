/**
 * Issue #820 — API Rate Limiting with Tier-Based Quotas
 *
 * Admin endpoints for managing per-client quota overrides and inspecting
 * current tier configurations at runtime.
 *
 * Routes (all under /api/v1/rate-limit):
 *   GET  /tiers             — list default tier configurations
 *   GET  /quotas            — list active per-client quota overrides
 *   PUT  /quotas/:clientKey — set or update a quota override for a client
 *   DELETE /quotas/:clientKey — remove a quota override (revert to tier default)
 *   GET  /policy            — describe enforcement policy (endpoint-level configs)
 */

import { Router, Request, Response } from 'express';
import {
  DEFAULT_TIER_CONFIGS,
  SANDBOX_TIER_CONFIGS,
  ENDPOINT_CONFIGS,
  setQuotaOverride,
  removeQuotaOverride,
  listQuotaOverrides,
  type QuotaOverride,
} from '../middleware/rate-limit.js';

export const rateLimitQuotasRouter = Router();

// ---------------------------------------------------------------------------
// GET /tiers  — describe default per-tier bucket configurations
// ---------------------------------------------------------------------------

rateLimitQuotasRouter.get('/tiers', (_req: Request, res: Response) => {
  res.json({
    data: {
      default: DEFAULT_TIER_CONFIGS,
      sandbox: SANDBOX_TIER_CONFIGS,
    },
    description: {
      capacity: 'Maximum tokens in the bucket (hourly burst capacity)',
      refillRate: 'Tokens added per second',
      burstAllowance: 'Extra tokens granted on top of capacity for short bursts',
    },
  });
});

// ---------------------------------------------------------------------------
// GET /quotas  — list all active runtime quota overrides
// ---------------------------------------------------------------------------

rateLimitQuotasRouter.get('/quotas', (_req: Request, res: Response) => {
  const overrides = listQuotaOverrides();
  res.json({ data: overrides, total: overrides.length });
});

// ---------------------------------------------------------------------------
// PUT /quotas/:clientKey  — create or update a quota override
//
// Body:
//   tier            — 'free' | 'pro' | 'enterprise'
//   capacity        — max tokens
//   refillRate      — tokens/second
//   burstAllowance  — extra burst tokens
//   expiresAt?      — ISO-8601 datetime; omit for permanent
// ---------------------------------------------------------------------------

rateLimitQuotasRouter.put('/quotas/:clientKey', (req: Request, res: Response) => {
  const { clientKey } = req.params;
  const { tier, capacity, refillRate, burstAllowance, expiresAt } = req.body as Partial<QuotaOverride>;

  if (!tier || !['free', 'pro', 'enterprise'].includes(tier)) {
    res.status(400).json({ error: 'Invalid or missing tier. Must be free | pro | enterprise.' });
    return;
  }
  if (typeof capacity !== 'number' || capacity < 1) {
    res.status(400).json({ error: 'capacity must be a positive number.' });
    return;
  }
  if (typeof refillRate !== 'number' || refillRate <= 0) {
    res.status(400).json({ error: 'refillRate must be a positive number.' });
    return;
  }
  if (typeof burstAllowance !== 'number' || burstAllowance < 0) {
    res.status(400).json({ error: 'burstAllowance must be a non-negative number.' });
    return;
  }
  if (expiresAt && isNaN(Date.parse(expiresAt))) {
    res.status(400).json({ error: 'expiresAt must be a valid ISO-8601 datetime.' });
    return;
  }

  const override: QuotaOverride = { tier, capacity, refillRate, burstAllowance, expiresAt };
  setQuotaOverride(clientKey, override);

  res.status(200).json({
    message: `Quota override applied for client '${clientKey}'.`,
    data: { clientKey, ...override },
  });
});

// ---------------------------------------------------------------------------
// DELETE /quotas/:clientKey  — remove a quota override
// ---------------------------------------------------------------------------

rateLimitQuotasRouter.delete('/quotas/:clientKey', (req: Request, res: Response) => {
  const { clientKey } = req.params;
  const removed = removeQuotaOverride(clientKey);

  if (!removed) {
    res.status(404).json({ error: `No quota override found for client '${clientKey}'.` });
    return;
  }

  res.json({ message: `Quota override removed for client '${clientKey}'.` });
});

// ---------------------------------------------------------------------------
// GET /policy  — describe endpoint-level rate-limit policy
// ---------------------------------------------------------------------------

rateLimitQuotasRouter.get('/policy', (_req: Request, res: Response) => {
  const policy = Object.entries(ENDPOINT_CONFIGS).map(([endpoint, cfg]) => ({
    endpoint,
    tiers: cfg,
  }));

  res.json({
    data: policy,
    description: 'Endpoint-specific token bucket configurations override the global tier defaults for matching path prefixes.',
  });
});
