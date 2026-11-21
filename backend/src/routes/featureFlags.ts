/**
 * featureFlags.ts — Persistent feature-flag API.
 *
 * Admin:
 *   POST   /                                  create flag
 *   GET    /                                  list flags
 *   GET    /stale                             list stale flags
 *   GET    /segments                          list segments
 *   POST   /segments                          create segment
 *   GET    /:key                              get flag + rules
 *   PATCH  /:key                              update flag
 *   DELETE /:key                              soft-archive (or ?hard=true)
 *   POST   /:key/rules                        add targeting rule
 *   DELETE /:key/rules/:ruleId                remove targeting rule
 *   POST   /:key/schedules                    create gradual rollout schedule
 *   POST   /:key/schedules/:id/start          activate schedule
 *   POST   /:key/schedules/:id/pause          pause schedule
 *   POST   /:key/schedules/:id/resume         resume schedule
 *   POST   /:key/experiments                  create A/B experiment
 *   POST   /:key/experiments/:id/start        start experiment
 *   POST   /:key/experiments/:id/abort        abort experiment
 *   GET    /:key/experiments/:id/results      per-variant results
 *   GET    /:key/analytics                    windowed evaluation stats
 *   GET    /:key/audit                        audit log
 *
 * Client:
 *   GET    /evaluate?flag=X&identifier=Y       deterministic evaluation
 *   GET    /state?identifier=Y                bulk client state
 *   POST   /exposure                          record client-side exposure
 */

import { Router, type Request } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import {
  featureFlagRegistry,
  CreateFlagSchema,
  CreateScheduleSchema,
  CreateExperimentSchema,
  TargetingRuleSchema,
  UpdateFlagSchema,
} from '../services/featureFlagRegistry.js';

export const featureFlagsRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireActor(req: Request): string {
  const actor =
    (req as Request & { user?: { id?: string; email?: string } }).user?.id ??
    (req as Request & { user?: { email?: string } }).user?.email ??
    req.headers['x-user-id'];
  if (typeof actor !== 'string' || !actor.trim())
    throw new AppError(401, 'authentication required', 'UNAUTHENTICATED');
  return actor;
}

function tenantOf(req: Request): string {
  const t = (req as Request & { tenantId?: string }).tenantId;
  return typeof t === 'string' && t.trim() ? t : 'default';
}

function qString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function qStringRequired(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new AppError(400, `${field} required`, 'VALIDATION_ERROR');
  }
  return value;
}

// ─── CLIENT endpoints ────────────────────────────────────────────────────────

// GET /api/v1/feature-flags/evaluate?flag=X&identifier=Y&environment=production
featureFlagsRouter.get(
  '/evaluate',
  asyncHandler(async (req, res) => {
    const flag = qStringRequired(req.query.flag, 'flag');
    const identifier = qStringRequired(req.query.identifier, 'identifier');
    const environment = qString(req.query.environment);
    const attributes: Record<string, unknown> = {};
    const tier = qString(req.query.tier) ?? qString(req.headers['x-user-tier']);
    const country = qString(req.query.country) ?? qString(req.headers['x-user-country']);
    if (tier !== undefined) attributes.tier = tier;
    if (country !== undefined) attributes.country = country;

    const result = await featureFlagRegistry.evaluate(flag, {
      identifier,
      environment,
      attributes,
    });
    res.json(result);
  }),
);

// GET /api/v1/feature-flags/state?identifier=Y
featureFlagsRouter.get(
  '/state',
  asyncHandler(async (req, res) => {
    const identifier = qStringRequired(req.query.identifier, 'identifier');
    const environment = qString(req.query.environment);
    const flags = await featureFlagRegistry.evaluateAll({ identifier, environment });
    res.json({ identifier, environment, flags });
  }),
);

// POST /api/v1/feature-flags/exposure
featureFlagsRouter.post(
  '/exposure',
  asyncHandler(async (req, res) => {
    const { flag, identifier, value, environment } = req.body as {
      flag?: string; identifier?: string; value?: unknown; environment?: string;
    };
    if (typeof flag !== 'string' || typeof identifier !== 'string')
      throw new AppError(400, 'flag + identifier required', 'VALIDATION_ERROR');
    const flagRow = await featureFlagRegistry.getFlagByKey(flag, { tenantId: tenantOf(req) });
    if (!flagRow) throw new AppError(404, `flag '${flag}' not found`, 'NOT_FOUND');
    await featureFlagRegistry.recordExposureEvent(flagRow.id, {
      identifier,
      environment,
      attributes: { userAgent: req.headers['user-agent'] as string | undefined },
    }, value);
    res.json({ recorded: true });
  }),
);

// ─── ADMIN endpoints ─────────────────────────────────────────────────────────

// POST /api/v1/feature-flags
featureFlagsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const actor = requireActor(req);
    const input = CreateFlagSchema.parse(req.body);
    const flag = await featureFlagRegistry.createFlag(input, actor, tenantOf(req));
    res.status(201).json(flag);
  }),
);

// GET /api/v1/feature-flags?status=active&environment=production&limit=50&offset=0
featureFlagsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = qString(req.query.status);
    const environment = qString(req.query.environment);
    const limitRaw = qString(req.query.limit);
    const offsetRaw = qString(req.query.offset);
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    const offset = offsetRaw ? parseInt(offsetRaw, 10) : 0;
    const page = await featureFlagRegistry.listFlags({ status, environment, limit, offset, tenantId: tenantOf(req) });
    res.json(page);
  }),
);

// GET /api/v1/feature-flags/stale?days=30&includeUnowned=true
featureFlagsRouter.get(
  '/stale',
  asyncHandler(async (req, res) => {
    const daysRaw = qString(req.query.days);
    const days = daysRaw ? parseInt(daysRaw, 10) : 30;
    const includeUnowned = req.query.includeUnowned === 'true';
    const stale = await featureFlagRegistry.detectStaleFlags({ staleAfterDays: days, includeUnowned, tenantId: tenantOf(req) });
    res.json({ staleAfterDays: days, count: stale.length, flags: stale });
  }),
);

// GET /api/v1/feature-flags/segments
featureFlagsRouter.get(
  '/segments',
  asyncHandler(async (req, res) => {
    res.json({ segments: await featureFlagRegistry.listSegments(tenantOf(req)) });
  }),
);

const CreateSegmentSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
  conditions: z
    .array(
      z.object({
        attribute: z.string(),
        operator: z.string().optional(),
        value: z.unknown(),
      }),
    )
    .min(1),
  matchType: z.enum(['all', 'any']).optional(),
});

// POST /api/v1/feature-flags/segments
featureFlagsRouter.post(
  '/segments',
  asyncHandler(async (req, res) => {
    const body = CreateSegmentSchema.parse(req.body);
    const seg = await featureFlagRegistry.createSegment({ tenantId: tenantOf(req), ...body });
    res.status(201).json(seg);
  }),
);

// GET /api/v1/feature-flags/:key
featureFlagsRouter.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const flag = await featureFlagRegistry.getFlagByKey(req.params.key, {
      includeRules: true,
      tenantId: tenantOf(req),
    });
    if (!flag) throw new AppError(404, `flag '${req.params.key}' not found`, 'NOT_FOUND');
    res.json(flag);
  }),
);

// PATCH /api/v1/feature-flags/:key
featureFlagsRouter.patch(
  '/:key',
  asyncHandler(async (req, res) => {
    const actor = requireActor(req);
    const updates = UpdateFlagSchema.parse(req.body);
    const flag = await featureFlagRegistry.updateFlag(req.params.key, updates, actor, tenantOf(req));
    res.json(flag);
  }),
);

// DELETE /api/v1/feature-flags/:key
featureFlagsRouter.delete(
  '/:key',
  asyncHandler(async (req, res) => {
    const actor = requireActor(req);
    const hard = req.query.hard === 'true';
    await featureFlagRegistry.deleteFlag(req.params.key, actor, { hard, tenantId: tenantOf(req) });
    res.status(204).send();
  }),
);

// POST /api/v1/feature-flags/:key/rules
featureFlagsRouter.post(
  '/:key/rules',
  asyncHandler(async (req, res) => {
    const actor = requireActor(req);
    const rule = TargetingRuleSchema.parse(req.body);
    const created = await featureFlagRegistry.addRule(req.params.key, rule, actor, tenantOf(req));
    res.status(201).json(created);
  }),
);

// DELETE /api/v1/feature-flags/:key/rules/:ruleId
featureFlagsRouter.delete(
  '/:key/rules/:ruleId',
  asyncHandler(async (req, res) => {
    const actor = requireActor(req);
    await featureFlagRegistry.removeRule(req.params.ruleId, actor);
    res.status(204).send();
  }),
);

// POST /api/v1/feature-flags/:key/schedules
featureFlagsRouter.post(
  '/:key/schedules',
  asyncHandler(async (req, res) => {
    const actor = requireActor(req);
    const body = CreateScheduleSchema.parse(req.body);
    const sched = await featureFlagRegistry.createSchedule({
      flagKey: req.params.key,
      createdBy: actor,
      tenantId: tenantOf(req),
      ...body,
    });
    res.status(201).json(sched);
  }),
);

featureFlagsRouter.post(
  '/:key/schedules/:scheduleId/start',
  asyncHandler(async (req, res) => {
    res.json(await featureFlagRegistry.startSchedule(req.params.scheduleId));
  }),
);

featureFlagsRouter.post(
  '/:key/schedules/:scheduleId/pause',
  asyncHandler(async (req, res) => {
    const reason = qString((req.body as { reason?: unknown })?.reason) ?? 'manual';
    res.json(await featureFlagRegistry.pauseSchedule(req.params.scheduleId, reason));
  }),
);

featureFlagsRouter.post(
  '/:key/schedules/:scheduleId/resume',
  asyncHandler(async (req, res) => {
    res.json(await featureFlagRegistry.resumeSchedule(req.params.scheduleId));
  }),
);

// POST /api/v1/feature-flags/:key/experiments
featureFlagsRouter.post(
  '/:key/experiments',
  asyncHandler(async (req, res) => {
    const actor = requireActor(req);
    const body = CreateExperimentSchema.parse(req.body);
    const exp = await featureFlagRegistry.createExperiment({
      flagKey: req.params.key,
      createdBy: actor,
      tenantId: tenantOf(req),
      ...body,
    });
    res.status(201).json(exp);
  }),
);

featureFlagsRouter.post(
  '/:key/experiments/:experimentId/start',
  asyncHandler(async (req, res) => {
    res.json(await featureFlagRegistry.startExperiment(req.params.experimentId));
  }),
);

featureFlagsRouter.post(
  '/:key/experiments/:experimentId/abort',
  asyncHandler(async (req, res) => {
    const reason = qString((req.body as { reason?: unknown })?.reason) ?? 'manual';
    res.json(await featureFlagRegistry.abortExperiment(req.params.experimentId, reason));
  }),
);

featureFlagsRouter.get(
  '/:key/experiments/:experimentId/results',
  asyncHandler(async (req, res) => {
    res.json({ results: await featureFlagRegistry.getExperimentResults(req.params.experimentId) });
  }),
);

// GET /api/v1/feature-flags/:key/analytics?windowHours=24
featureFlagsRouter.get(
  '/:key/analytics',
  asyncHandler(async (req, res) => {
    const hoursRaw = qString(req.query.windowHours);
    const hours = hoursRaw ? parseInt(hoursRaw, 10) : 24;
    res.json(await featureFlagRegistry.getAnalytics(req.params.key, { windowHours: hours, tenantId: tenantOf(req) }));
  }),
);

// GET /api/v1/feature-flags/:key/audit?limit=50
featureFlagsRouter.get(
  '/:key/audit',
  asyncHandler(async (req, res) => {
    const limitRaw = qString(req.query.limit);
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    res.json({ logs: await featureFlagRegistry.listAuditLogs(req.params.key, { limit, tenantId: tenantOf(req) }) });
  }),
);
