/**
 * flags.ts — Admin endpoints for inspecting and overriding feature flags.
 *
 * Routes (all under /api/v1/flags):
 *
 *   GET  /              — list all flags with current state and usage stats
 *   GET  /:name         — get a single flag
 *   PATCH /:name        — runtime override (enabled, rolloutPercentage, allowlist)
 *   POST  /:name/reset  — reset a flag to its default / env-var value
 */

import { Router } from 'express';
import { featureFlags, FeatureFlagName } from '../config/featureFlags.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

export const flagsRouter = Router();

// GET /api/v1/flags
flagsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      flags: featureFlags.getAll().map(serializeFlag),
      total: featureFlags.getAll().length,
    });
  }),
);

// GET /api/v1/flags/:name
flagsRouter.get(
  '/:name',
  asyncHandler(async (req, res) => {
    const name = req.params.name as FeatureFlagName;
    const flag = featureFlags.get(name);

    if (!flag) {
      throw new AppError(404, `Feature flag '${name}' not found`, 'NOT_FOUND');
    }

    res.json(serializeFlag(flag));
  }),
);

// PATCH /api/v1/flags/:name
// Body: { enabled?: boolean, rolloutPercentage?: number, allowlist?: string[] }
flagsRouter.patch(
  '/:name',
  asyncHandler(async (req, res) => {
    const name = req.params.name as FeatureFlagName;

    if (!featureFlags.get(name)) {
      throw new AppError(404, `Feature flag '${name}' not found`, 'NOT_FOUND');
    }

    const { enabled, rolloutPercentage, allowlist } = req.body as {
      enabled?: boolean;
      rolloutPercentage?: number;
      allowlist?: string[];
    };

    const hasUpdate = enabled !== undefined || rolloutPercentage !== undefined || allowlist !== undefined;
    if (!hasUpdate) {
      throw new AppError(400, 'Provide at least one of: enabled, rolloutPercentage, allowlist', 'VALIDATION_ERROR');
    }

    if (rolloutPercentage !== undefined && (rolloutPercentage < 0 || rolloutPercentage > 100)) {
      throw new AppError(400, 'rolloutPercentage must be between 0 and 100', 'VALIDATION_ERROR');
    }

    featureFlags.override(name, { enabled, rolloutPercentage, allowlist });

    const updated = featureFlags.get(name)!;
    res.json(serializeFlag(updated));
  }),
);

// POST /api/v1/flags/:name/reset
flagsRouter.post(
  '/:name/reset',
  asyncHandler(async (req, res) => {
    const name = req.params.name as FeatureFlagName;

    if (!featureFlags.get(name)) {
      throw new AppError(404, `Feature flag '${name}' not found`, 'NOT_FOUND');
    }

    featureFlags.reset(name);

    const reset = featureFlags.get(name)!;
    res.json(serializeFlag(reset));
  }),
);

// ─── Serialiser ───────────────────────────────────────────────────────────────

function serializeFlag(flag: ReturnType<typeof featureFlags.get>) {
  if (!flag) return null;
  return {
    name:               flag.definition.name,
    description:        flag.definition.description,
    defaultEnabled:     flag.definition.defaultEnabled,
    currentStrategy:    flag.currentStrategy,
    rolloutPercentage:  flag.currentRolloutPercentage,
    overridden:         flag.overridden,
    usage:              flag.usage,
  };
}
