/**
* flags.ts — Admin and Client endpoints for inspecting, overriding, and evaluating feature flags.
*
* Routes (all under /api/v1/flags):
* * GET  /evaluate      — (Client) evaluate a single flag for a user deterministically
* GET  /state         — (Client) bulk fetch all active flags for a user
* GET  /              — (Admin) list all flags with current state and usage stats
* GET  /:name         — (Admin) get a single flag
* PATCH /:name        — (Admin) runtime override (enabled, rolloutPercentage, allowlist)
* POST  /:name/reset  — (Admin) reset a flag to its default / env-var value
*/

import { Router } from 'express';
import { createHash } from 'node:crypto';
import { featureFlags, FeatureFlagName } from '../config/featureFlags.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { paginateArray } from '../utils/pagination.js';

export const flagsRouter = Router();

// ─── Deterministic Evaluation Engine ──────────────────────────────────────────

/**
* Deterministically evaluates a flag using the existing config object.
* Hashes the user identifier to ensure consistent A/B test experiences.
*/
function evaluateDeterministic(name: FeatureFlagName, identifier: string): boolean {
  const flag = featureFlags.get(name);
  if (!flag) return false;

  const rollout = flag.currentRolloutPercentage;

  // Safely extract allowlist (handling potential type variations in the existing config)
  const allowlist: string[] = (flag as any).allowlist || (flag as any).definition?.allowlist || [];

  // 1. User Targeting: If user is explicitly targeted, they get it
  if (allowlist.includes(identifier)) return true;

  // 2. Global Toggles: If no percentage is set, fallback to default status
  if (rollout === undefined || rollout === null) {
    return flag.definition.defaultEnabled ?? false;
  }

  // 3. Absolute Rollouts
  if (rollout >= 100) return true;
  if (rollout <= 0) return false;

  // 4. Percentage Rollout (A/B Testing)
  const hash = createHash('md5').update(`${name}-${identifier}`).digest('hex');
  const hashInt = parseInt(hash.substring(0, 4), 16);
  const normalizedHash = (hashInt % 100) + 1;

  return normalizedHash <= rollout;
}

// ─── CLIENT ENDPOINTS ─────────────────────────────────────────────────────────

// GET /api/v1/flags/evaluate?flag=name&identifier=user123
flagsRouter.get(
  '/evaluate',
  asyncHandler(async (req, res) => {
    const { flag, identifier } = req.query;

    if (typeof flag !== 'string' || typeof identifier !== 'string') {
      throw new AppError(400, 'Missing flag name or identifier in query', 'VALIDATION_ERROR');
    }

    const isEnabled = evaluateDeterministic(flag as FeatureFlagName, identifier);

    res.json({
      flag,
      identifier,
      enabled: isEnabled
    });
  })
);

// GET /api/v1/flags/state?identifier=user123
flagsRouter.get(
  '/state',
  asyncHandler(async (req, res) => {
    const { identifier } = req.query;

    if (typeof identifier !== 'string') {
      throw new AppError(400, 'Missing identifier in query', 'VALIDATION_ERROR');
    }

    const allFlags = featureFlags.getAll();
    const clientState: Record<string, boolean> = {};

    allFlags.forEach(f => {
      clientState[f.definition.name] = evaluateDeterministic(f.definition.name as FeatureFlagName, identifier);
    });

    res.json({ identifier, flags: clientState });
  })
);


// ─── ADMIN ENDPOINTS (Existing Code Preserved) ────────────────────────────────

// GET /api/v1/flags
flagsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const flags = featureFlags.getAll().map(serializeFlag);

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

    const paginated = paginateArray(flags, { limit, offset });

    res.json({
      flags: paginated.data,
      total: paginated.total,
      limit: paginated.limit,
      offset: paginated.offset,
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